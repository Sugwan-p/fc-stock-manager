
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { fail } from "@/lib/http";

type QueueInput = {
  mall: string;
  product_no: number;
  memo?: string;
};

function isValidItem(item: unknown): item is QueueInput {
  if (!item || typeof item !== "object") {
    return false;
  }

  const value = item as Record<string, unknown>;

  return (
    typeof value.mall === "string" &&
    /^[a-z0-9_-]{2,40}$/.test(value.mall) &&
    typeof value.product_no === "number" &&
    Number.isSafeInteger(value.product_no) &&
    value.product_no > 0 &&
    (value.memo === undefined ||
      (typeof value.memo === "string" &&
        value.memo.length <= 200))
  );
}

function isValidItems(items: unknown): items is QueueInput[] {
  return (
    Array.isArray(items) &&
    items.length > 0 &&
    items.length <= 200 &&
    items.every(isValidItem)
  );
}

// 해제 예정 목록 조회
export async function GET() {
  try {
    await requireAdmin();

    const { data, error } = await db()
      .from("cafe24_release_queue")
      .select("mall_id,product_no,memo,created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("GET /api/queue 오류:", error);
      throw error;
    }

    return NextResponse.json({
      items: data ?? [],
    });
  } catch (error) {
    return fail(error);
  }
}

// 해제 예정 상품 등록
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();

    const body: unknown = await req.json();
    const items = (
      body && typeof body === "object"
        ? (body as Record<string, unknown>).items
        : undefined
    );

    if (!isValidItems(items)) {
      return NextResponse.json(
        { error: "올바른 상품 목록을 입력해주세요." },
        { status: 400 }
      );
    }

    const rows = items.map((item) => ({
      mall_id: item.mall,
      product_no: item.product_no,
      memo: item.memo ?? "",
    }));

    const { error } = await db()
      .from("cafe24_release_queue")
      .upsert(rows, {
        onConflict: "mall_id,product_no",
      });

    if (error) {
      console.error("POST /api/queue 오류:", error);
      throw error;
    }

    return NextResponse.json({
      ok: true,
      count: rows.length,
    });
  } catch (error) {
    return fail(error);
  }
}

// 해제 예정 상품 삭제
export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin();

    const body: unknown = await req.json();
    const items = (
      body && typeof body === "object"
        ? (body as Record<string, unknown>).items
        : undefined
    );

    if (!isValidItems(items)) {
      return NextResponse.json(
        { error: "올바른 상품 목록을 입력해주세요." },
        { status: 400 }
      );
    }

    for (const item of items) {
      const { error } = await db()
        .from("cafe24_release_queue")
        .delete()
        .eq("mall_id", item.mall)
        .eq("product_no", item.product_no);

      if (error) {
        console.error(
          "DELETE /api/queue 오류:",
          error
        );
        throw error;
      }
    }

    return NextResponse.json({
      ok: true,
      count: items.length,
    });
  } catch (error) {
    return fail(error);
  }
}
