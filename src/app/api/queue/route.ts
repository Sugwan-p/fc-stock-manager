import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { fail } from "@/lib/http";
import { api as cafe24Api, mallId } from "@/lib/cafe24";

type Item = { mall: string; product_no: number; memo?: string };
function validItems(value: unknown): value is Item[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 200 && value.every((v: unknown) => {
    if (!v || typeof v !== "object") return false;
    const x = v as Record<string, unknown>;
    return typeof x.mall === "string" && /^[a-z0-9_-]{2,40}$/.test(x.mall) &&
      typeof x.product_no === "number" && Number.isSafeInteger(x.product_no) && x.product_no > 0 &&
      (x.memo === undefined || (typeof x.memo === "string" && x.memo.length <= 200));
  });
}
function parseBody(body: unknown): { items?: unknown; scheduled_date?: unknown } {
  return body && typeof body === "object" ? body as { items?: unknown; scheduled_date?: unknown } : {};
}
export async function GET() {
  try {
    await requireAdmin();
    const { data, error } = await db().from("cafe24_release_queue")
      .select("mall_id,product_no,memo,created_at,scheduled_date,status,completed_at")
      .eq("status", "pending").order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ items: data ?? [] });
  } catch (error) { return fail(error); }
}
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const { items, scheduled_date } = parseBody(await req.json());
    if (!validItems(items)) return NextResponse.json({ error: "상품 목록이 올바르지 않습니다." }, { status: 400 });
    if (typeof scheduled_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(scheduled_date) ||
      !Number.isFinite(Date.parse(`${scheduled_date}T00:00:00Z`)) ||
      new Date(`${scheduled_date}T00:00:00Z`).toISOString().slice(0,10) !== scheduled_date) {
      return NextResponse.json({ error: "올바른 예정 날짜를 입력해주세요." }, { status: 400 });
    }
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0,10);
    if (scheduled_date < today) return NextResponse.json({ error: "오늘 또는 이후 날짜를 선택해주세요." }, { status: 400 });
    const rows = items.map(item => ({ mall_id: mallId(item.mall), product_no: item.product_no,
      memo: item.memo ?? "", scheduled_date, status: "pending", completed_at: null, updated_at: new Date().toISOString() }));
    const { error } = await db().from("cafe24_release_queue").upsert(rows, { onConflict: "mall_id,product_no" });
    if (error) throw error;
    return NextResponse.json({ ok: true, count: rows.length });
  } catch (error) { return fail(error); }
}
// 목록 삭제는 실제 데이터 삭제 대신 취소 이력으로 보관합니다.
export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin();
    const { items } = parseBody(await req.json());
    if (!validItems(items)) return NextResponse.json({ error: "상품 목록이 올바르지 않습니다." }, { status: 400 });
    for (const item of items) {
      const { error } = await db().from("cafe24_release_queue")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("mall_id", item.mall).eq("product_no", item.product_no).eq("status", "pending");
      if (error) throw error;
    }
    return NextResponse.json({ ok: true, count: items.length });
  } catch (error) { return fail(error); }
}
// 품절 해제 성공 후 호출. 실제 카페24 판매 상태를 재검증하고 완료로 기록합니다.
export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
    const { items } = parseBody(await req.json());
    if (!validItems(items)) return NextResponse.json({ error: "상품 목록이 올바르지 않습니다." }, { status: 400 });
    const results = await Promise.all(items.map(async item => {
      try {
        const response = await cafe24Api(item.mall, `products/${item.product_no}`) as { product?: { selling?: string; display?: string } };
        if (response.product?.selling !== "T" || response.product?.display !== "T") {
          return { mall: item.mall, product_no: item.product_no, ok: false, error: "판매함/진열함 상태를 확인하지 못했습니다." };
        }
        const { error } = await db().from("cafe24_release_queue")
          .update({ status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("mall_id", item.mall).eq("product_no", item.product_no).eq("status", "pending");
        if (error) throw error;
        return { mall: item.mall, product_no: item.product_no, ok: true };
      } catch (e) { return { mall: item.mall, product_no: item.product_no, ok: false, error: e instanceof Error ? e.message : String(e) }; }
    }));
    return NextResponse.json({ ok: results.every(r => r.ok), results });
  } catch (error) { return fail(error); }
}
