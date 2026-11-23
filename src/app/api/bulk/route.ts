
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { api } from "@/lib/cafe24";
import { db } from "@/lib/db";
import { fail } from "@/lib/http";

type Item = {
  mall: string;
  product_no: number;
};

type Action = "stop" | "resume" | "show" | "hide" | "price";

type RequestBody = {
  items?: Item[];
  action?: Action;
  text?: string;
  clearPriceContent?: boolean;
};

type Result = {
  mall: string;
  product_no: number;
  ok: boolean;
  error?: string;
};

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();

    const body = (await req.json()) as RequestBody;

    const actions: Action[] = [
      "stop",
      "resume",
      "show",
      "hide",
      "price",
    ];

    if (
      !Array.isArray(body.items) ||
      body.items.length === 0 ||
      body.items.length > 200 ||
      !body.action ||
      !actions.includes(body.action) ||
      (body.text !== undefined &&
        (typeof body.text !== "string" ||
          body.text.length > 20)) ||
      (body.action === "price" &&
        typeof body.text !== "string") ||
      (body.clearPriceContent !== undefined &&
        typeof body.clearPriceContent !== "boolean")
    ) {
      throw new Error("BAD_REQUEST");
    }

    const { data: rows, error } = await db()
      .from("cafe24_malls")
      .select("mall_id");

    if (error) throw error;

    const allowed = new Set(
      (rows || []).map((row) => row.mall_id)
    );

    const unique = [
      ...new Map(
        body.items.map((item) => [
          `${item.mall}:${item.product_no}`,
          item,
        ])
      ).values(),
    ];

    if (
      unique.some(
        (item) =>
          !item ||
          typeof item.mall !== "string" ||
          !allowed.has(item.mall) ||
          !Number.isSafeInteger(item.product_no) ||
          item.product_no <= 0
      )
    ) {
      throw new Error("BAD_REQUEST");
    }

    const results: Result[] = [];

    for (const item of unique) {
      try {
        let request: Record<string, string>;

        switch (body.action) {
          // 품절 처리
          case "stop": {
            const phrase = (body.text ?? "").trim();

            request = {
              selling: "F",
              display: phrase ? "T" : "F",
              price_content: phrase,
            };

            break;
          }

          // 품절 해제
          case "resume": {
            request = {
              selling: "T",
              display: "T",
            };

            if (body.clearPriceContent) {
              request.price_content = "";
            }

            break;
          }

          // 진열함
          case "show": {
            request = {
              display: "T",
            };

            break;
          }

          // 진열안함
          case "hide": {
            request = {
              display: "F",
            };

            break;
          }

          // 대체 문구 변경
          // 판매 상태는 변경하지 않음
          case "price": {
            const phrase = (body.text ?? "").trim();

            request = {
              price_content: phrase,
            };

            // 문구를 입력하면 진열함으로 변경
            if (phrase) {
              request.display = "T";
            }

            // 빈칸이면 대체 문구만 삭제
            // 판매 상태와 진열 상태는 그대로 유지
            break;
          }

          default: {
            throw new Error("BAD_REQUEST");
          }
        }

        await api(
          item.mall,
          `products/${item.product_no}`,
          {
            method: "PUT",
            body: { request },
          }
        );

        results.push({
          ...item,
          ok: true,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "알 수 없는 오류";

        console.error(
          "카페24 상품 일괄 처리 실패",
          {
            mall: item.mall,
            product_no: item.product_no,
            action: body.action,
            message,
          }
        );

        results.push({
          ...item,
          ok: false,
          error: message.startsWith("Cafe24")
            ? message
            : "수정 실패. 상품 설정 또는 API 권한을 확인해주세요.",
        });
      }
    }

    return NextResponse.json({
      results,
      success: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
    });
  } catch (error) {
    return fail(error);
  }
}
