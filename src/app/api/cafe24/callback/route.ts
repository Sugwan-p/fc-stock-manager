
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { loggedIn } from "@/lib/auth";
import { exchange, saveTokens } from "@/lib/cafe24";

function equal(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);

  return (
    x.length === y.length &&
    timingSafeEqual(x, y)
  );
}

export async function GET(req: NextRequest) {
  const destination = new URL("/", req.url);

  const cookie =
    req.cookies.get("fc_oauth")?.value || "";

  const separator = cookie.indexOf(":");

  const mall =
    separator >= 0
      ? cookie.slice(0, separator)
      : "";

  const savedState =
    separator >= 0
      ? cookie.slice(separator + 1)
      : "";

  const code =
    req.nextUrl.searchParams.get("code");

  const state =
    req.nextUrl.searchParams.get("state");

  const oauthError =
    req.nextUrl.searchParams.get("error");

  function redirect(status: string) {
    destination.searchParams.set(
      "oauth",
      status
    );

    const response =
      NextResponse.redirect(destination);

    response.cookies.delete("fc_oauth");

    return response;
  }

  if (oauthError) {
    console.error("카페24 OAuth 승인 오류", {
      mall,
      error: oauthError,
    });

    return redirect("error");
  }

  if (!(await loggedIn())) {
    console.error(
      "카페24 OAuth 콜백 오류: 관리자 세션 없음"
    );

    return redirect("error");
  }

  if (
    !mall ||
    !savedState ||
    !code ||
    !state
  ) {
    console.error(
      "카페24 OAuth 콜백 오류: 필수 값 누락",
      {
        hasMall: Boolean(mall),
        hasSavedState: Boolean(savedState),
        hasCode: Boolean(code),
        hasState: Boolean(state),
      }
    );

    return redirect("error");
  }

  if (!equal(savedState, state)) {
    console.error(
      "카페24 OAuth 콜백 오류: state 불일치"
    );

    return redirect("error");
  }

  try {
    const tokens = await exchange(
      mall,
      code
    );

    await saveTokens(mall, tokens);

    console.info(
      "카페24 쇼핑몰 연결 완료",
      { mall }
    );

    return redirect("success");
  } catch (error) {
    console.error(
      "카페24 OAuth 콜백 처리 실패",
      {
        mall,
        message:
          error instanceof Error
            ? error.message
            : "알 수 없는 오류",
      }
    );

    return redirect("error");
  }
}
