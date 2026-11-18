import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { api, mallId } from "@/lib/cafe24";
import { db } from "@/lib/db";
import { fail } from "@/lib/http";

type RawProduct = {
  product_no?: number | string;
  product_code?: string;
  custom_product_code?: string;
  product_name?: string;
  selling?: string;
  display?: string;
  price_content?: string;
};
type Product = {
  mall: string; product_no: number; product_code: string;
  custom_product_code: string; product_name: string;
  selling: boolean; display: boolean; price_content: string;
};
type Mode = "stop" | "resume" | "queue";
type QueueRow = { mall_id: string; product_no: number };
const LIMIT = 50;
const MAX_OFFSET = 4900;

function normalize(mall: string, p: RawProduct): Product {
  return {
    mall, product_no: Number(p.product_no),
    product_code: String(p.product_code || ""),
    custom_product_code: String(p.custom_product_code || ""),
    product_name: String(p.product_name || ""),
    selling: p.selling === "T", display: p.display === "T",
    price_content: String(p.price_content || ""),
  };
}
function matches(p: RawProduct, q: string) {
  const needle = q.toLocaleLowerCase();
  return [p.product_name, p.product_code, p.custom_product_code]
    .some(v => String(v || "").toLocaleLowerCase().includes(needle));
}
function valid(p: RawProduct) {
  const n = Number(p.product_no);
  return Number.isSafeInteger(n) && n > 0;
}
async function list(mall: string, params: URLSearchParams): Promise<RawProduct[]> {
  const result = await api(mall, `products?${params.toString()}`) as { products?: RawProduct[] };
  return Array.isArray(result.products) ? result.products : [];
}
async function statusProducts(mall: string, mode: "stop" | "resume", page: number, search: string) {
  const wanted = mode === "stop" ? "T" : "F";
  const offset = (page - 1) * LIMIT;
  if (offset > MAX_OFFSET) {
    return { products: [] as RawProduct[], hasMore: false, warnings: [`${mall}: 카페24는 5000번째 이후 offset 조회를 지원하지 않습니다. 검색어로 좁혀주세요.`] };
  }
  const base = new URLSearchParams({ limit: String(LIMIT), offset: String(offset), selling: wanted });
  if (!search) {
    const rows = await list(mall, base);
    return {
      products: rows.filter(p => valid(p) && p.selling === wanted),
      hasMore: rows.length === LIMIT && offset + LIMIT < 5000,
      warnings: [] as string[],
    };
  }
  // 카페24에서 지원하는 검색 조건을 직접 사용하여 전체 상품 순회를 방지합니다.
  // 조건별 검색은 독립적이며, 지원하지 않는 조건의 오류는 다른 검색에 영향을 주지 않습니다.
  const fields = ["product_name", "custom_product_code", "product_code"] as const;
  const settled = await Promise.allSettled(fields.map(field => {
    const params = new URLSearchParams(base);
    params.set(field, search);
    return list(mall, params);
  }));
  const map = new Map<number, RawProduct>();
  let successes = 0;
  let more = false;
  const warnings: string[] = [];
  for (let i = 0; i < settled.length; i++) {
    const entry = settled[i];
    if (entry.status === "rejected") {
      const reason = entry.reason instanceof Error ? entry.reason.message : "API 요청 실패";
      console.warn("Cafe24 검색 조건 오류", { mall, field: fields[i], reason });
      continue;
    }
    successes++;
    if (entry.value.length === LIMIT) more = true;
    for (const p of entry.value) {
      if (valid(p) && p.selling === wanted && matches(p, search)) map.set(Number(p.product_no), p);
    }
  }
  if (!successes) throw new Error("카페24 상품 검색 요청이 모두 실패했습니다. Vercel 로그를 확인해주세요.");
  if (successes < fields.length) warnings.push(`${mall}: 일부 검색 조건을 카페24에서 지원하지 않아 결과가 누락될 수 있습니다.`);
  // 여러 검색 조건의 중복을 제거합니다. 검색 결과는 최대 150개이며 API 호출은 최대 3회입니다.
  return { products: [...map.values()], hasMore: more && offset + LIMIT < 5000, warnings };
}
async function queueProducts(mall: string, rows: QueueRow[], search: string) {
  const targets = rows.filter(r => r.mall_id === mall);
  const products: RawProduct[] = [];
  // 요청이 폭증하지 않도록 5개씩 병렬 처리합니다.
  for (let i = 0; i < targets.length; i += 5) {
    const batch = await Promise.allSettled(targets.slice(i, i + 5).map(async r => {
      const result = await api(mall, `products/${r.product_no}`) as { product?: RawProduct };
      return result.product;
    }));
    for (const item of batch) {
      if (item.status === "fulfilled" && item.value && valid(item.value) && matches(item.value, search)) products.push(item.value);
    }
  }
  return products;
}
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const requested = req.nextUrl.searchParams.get("mall") || "all";
    const search = (req.nextUrl.searchParams.get("q") || "").trim();
    const rawPage = Number(req.nextUrl.searchParams.get("page") || "1");
    const page = Number.isFinite(rawPage) ? Math.max(1, Math.min(100, Math.floor(rawPage))) : 1;
    const rawMode = req.nextUrl.searchParams.get("mode");
    const mode: Mode = rawMode === "resume" ? "resume" : rawMode === "queue" ? "queue" : "stop";
    if (requested !== "all") mallId(requested);
    const { data: malls, error } = await db().from("cafe24_malls").select("mall_id").order("mall_id");
    if (error) throw error;
    const ids = (malls || []).map(row => row.mall_id as string).filter(id => requested === "all" || requested === id);
    if (!ids.length) return NextResponse.json({ products: [], errors: ["연결된 쇼핑몰이 없습니다."], page, hasMore: false });
    let queueRows: QueueRow[] = [];
    if (mode === "queue") {
      const { data, error: queueError } = await db().from("cafe24_release_queue").select("mall_id,product_no");
      if (queueError) throw queueError;
      queueRows = (data || []) as QueueRow[];
    }
    const results = await Promise.all(ids.map(async mall => {
      try {
        if (mode === "queue") {
          const rows = await queueProducts(mall, queueRows, search);
          return { products: rows.map(p => normalize(mall, p)), hasMore: false, errors: [] as string[] };
        }
        const found = await statusProducts(mall, mode, page, search);
        return { products: found.products.map(p => normalize(mall, p)), hasMore: found.hasMore, errors: found.warnings };
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        console.error("상품 조회 실패", { mall, mode, reason });
        return { products: [] as Product[], hasMore: false, errors: [`${mall} 상품 조회 실패: ${reason}`] };
      }
    }));
    return NextResponse.json({
      products: results.flatMap(r => r.products),
      errors: results.flatMap(r => r.errors),
      page,
      hasMore: results.some(r => r.hasMore),
    });
  } catch (e) {
    console.error("GET /api/products 오류", e);
    return fail(e);
  }
}
