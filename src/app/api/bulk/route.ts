
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
};

type Result = {
  mall: string;
  product_no: number;
  ok: boolean;
  error?: string;
};

export async function POST(req: NextRequest) {
  try {
    // 관리자 로그인 확인
    await requireAdmin();

    const body = (await req.json()) as RequestBody;

    // 요청 데이터 검증
    if (
      !Array.isArray(body.items) ||
      body.items.length === 0 ||
      body.items.length > 200 ||
      !["stop", "resume", "show", "hide", "price"].includes(
        body.action || ""
      )
    ) {
      throw new Error("BAD_REQUEST");
    }

    // 가격 관련 문구 검증
    if (
      body.action === "price" &&
      (typeof body.text !== "string" ||
        body.text.length > 20)
    ) {
      throw new Error("BAD_REQUEST");
    }

    // 연결된 쇼핑몰 목록 조회
    const { data: rows, error } = await db()
      .from("cafe24_malls")
      .select("mall_id");

    if (error) {
      console.error("쇼핑몰 목록 조회 실패", {
        code: error.code,
        message: error.message,
      });

      throw error;
    }

    // 등록된 쇼핑몰만 처리 허용
    const allowed = new Set(
      (rows || []).map((row) => row.mall_id)
    );

    // 동일 쇼핑몰의 동일 상품 중복 제거
    const unique = [
      ...new Map(
        body.items.map((item) => [
          `${item.mall}:${item.product_no}`,
          item,
        ])
      ).values(),
    ];

    // 쇼핑몰 ID 및 상품번호 검증
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

    // 선택 상품 순차 처리
    for (const item of unique) {
      try {
        let request: Record<string, string>;

        switch (body.action) {
          case "stop":
            // 판매안함
            request = { selling: "F" };
            break;

          case "resume":
            // 판매함
            request = { selling: "T" };
            break;

          case "show":
            // 상품 진열
            request = { display: "T" };
            break;

          case "hide":
            // 상품 진열안함
            request = { display: "F" };
            break;

          case "price":
            // 추가 가격 문구
            request = {
              price_content: body.text || "",
            };
            break;

          default:
            throw new Error("BAD_REQUEST");
        }

        // 카페24 상품 수정 API 호출
        await api(
          item.mall,
          `products/${item.product_no}`,
          {
            method: "PUT",
            body: {
              request,
            },
          }
        );

        // 품절 해제 성공 시 해제 예정 목록에서도 제거
        if (body.action === "resume") {
          const { error: queueError } = await db()
            .from("cafe24_release_queue")
            .delete()
            .eq("mall_id", item.mall)
            .eq("product_no", item.product_no);

          if (queueError) {
            console.error(
              "해제 예정 목록 삭제 실패",
              {
                mall: item.mall,
                product_no: item.product_no,
                code: queueError.code,
                message: queueError.message,
              }
            );

            // 상품 수정은 이미 성공했으므로
            // 해제 예정 목록 삭제 실패를 별도 기록
            results.push({
              ...item,
              ok: true,
              error:
                "상품 수정 성공, 해제 예정 목록 삭제 실패",
            });

            continue;
          }
        }

        results.push({
          ...item,
          ok: true,
        });
      } catch (error) {
        console.error("카페24 상품 일괄 처리 실패", {
          mall: item.mall,
          product_no: item.product_no,
          action: body.action,
          message:
            error instanceof Error
              ? error.message
              : "알 수 없는 오류",
        });

        results.push({
          ...item,
          ok: false,
          error:
            "수정 실패. 상품 설정 또는 API 권한을 확인해주세요.",
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
