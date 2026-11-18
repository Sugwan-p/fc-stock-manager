import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { api, mallId } from "@/lib/cafe24";
import { db } from "@/lib/db";
import { fail } from "@/lib/http";

type Cafe24Product = {
  product_no?: number | string;
  product_code?: string;
  custom_product_code?: string;
  product_name?: string;
  selling?: string;
  display?: string;
  price_content?: string;
};

type Product = {
  mall: string;
  product_no: number;
  product_code: string;
  custom_product_code: string;
  product_name: string;
  selling: boolean;
  display: boolean;
  price_content: string;
};

type QueueRow = { mall_id: string; product_no: number };
type Mode = "stop" | "resume" | "queue";

const PAGE_SIZE = 50;
const FETCH_SIZE = 100;
const MAX_SCAN_PAGES = 100;

function normalizeProduct(mall: string, p: Cafe24Product): Product {
  return {
    mall,
    product_no: Number(p.product_no),
    product_code: String(p.product_code || ""),
    custom_product_code: String(p.custom_product_code || ""),
    product_name: String(p.product_name || ""),
    selling: p.selling === "T",
    display: p.display === "T",
    price_content: String(p.price_content || ""),
  };
}

function matchesKeyword(p: Cafe24Product, keyword: string): boolean {
  if (!keyword) return true;
  const lower = keyword.toLocaleLowerCase();
  return [p.product_name, p.product_code, p.custom_product_code]
    .some((value) => String(value || "").toLocaleLowerCase().includes(lower));
}

async function listPage(
  mall: string,
  offset: number,
  extra: Record<string, string> = {}
): Promise<Cafe24Product[]> {
  const qs = new URLSearchParams({
    limit: String(FETCH_SIZE),
    offset: String(offset),
    ...extra,
  });
  const result = await api(mall, `products?${qs.toString()}`) as {
    products?: Cafe24Product[];
  };
  return Array.isArray(result.products) ? result.products : [];
}

// 카페24 검색 조건을 이용하되, 검색 결과를 다시 확인합니다.
// API의 selling 필터가 지원되지 않거나 무시되더라도 정확히 표시되도록
// 전체 목록을 순회하는 대체 경로를 사용합니다.
async function listByStatus(
  mall: string,
  mode: "stop" | "resume",
  page: number,
  search: string
): Promise<{ products: Cafe24Product[]; hasMore: boolean; warning?: string }> {
  const wanted = mode === "stop" ? "T" : "F";
  const start = (page - 1) * PAGE_SIZE;
  const required = start + PAGE_SIZE + 1;
  const matches = new Map<number, Cafe24Product>();
  let reachedEnd = false;
  let scanLimitReached = false;

  // 검색 조건이 없으면 서버 필터를 먼저 시도합니다.
  // 검색 시에는 이름/자체코드/카페24코드 모두 포함되도록 전체 목록을 검사합니다.
  if (!search) {
    const first = await listPage(mall, 0, { selling: wanted });
    if (first.length > 0 && first.every((p) => p.selling === wanted)) {
      for (const p of first) {
        const no = Number(p.product_no);
        if (Number.isSafeInteger(no) && no > 0) matches.set(no, p);
      }
      if (first.length < FETCH_SIZE) reachedEnd = true;
      for (let i = 1; !reachedEnd && i < MAX_SCAN_PAGES && matches.size < required; i++) {
        const rows = await listPage(mall, i * FETCH_SIZE, { selling: wanted });
        for (const p of rows) {
          if (p.selling !== wanted) continue;
          const no = Number(p.product_no);
          if (Number.isSafeInteger(no) && no > 0) matches.set(no, p);
        }
        if (rows.length < FETCH_SIZE) reachedEnd = true;
        if (i === MAX_SCAN_PAGES - 1 && !reachedEnd) scanLimitReached = true;
      }
      const all = [...matches.values()];
      return {
        products: all.slice(start, start + PAGE_SIZE),
        hasMore: all.length > start + PAGE_SIZE || (!reachedEnd && scanLimitReached),
        ...(scanLimitReached ? { warning: `${mall}: 조회 범위가 10,000개를 초과했습니다. 검색어로 좁혀주세요.` } : {}),
      };
    }
  }

  // 카페24 판매여부 필터가 무시되거나 검색어가 있을 때의 안전한 경로.
  // 원본 전체 상품을 순회한 뒤 판매여부와 검색어를 함께 검사합니다.
  for (let i = 0; i < MAX_SCAN_PAGES && matches.size < required; i++) {
    const rows = await listPage(mall, i * FETCH_SIZE);
    for (const p of rows) {
      if (p.selling !== wanted || !matchesKeyword(p, search)) continue;
      const no = Number(p.product_no);
      if (Number.isSafeInteger(no) && no > 0) matches.set(no, p);
    }
    if (rows.length < FETCH_SIZE) {
      reachedEnd = true;
      break;
    }
    if (i === MAX_SCAN_PAGES - 1) scanLimitReached = true;
  }
  const all = [...matches.values()];
  return {
    products: all.slice(start, start + PAGE_SIZE),
    hasMore: all.length > start + PAGE_SIZE || (!reachedEnd && scanLimitReached),
    ...(scanLimitReached ? { warning: `${mall}: 최대 10,000개 상품까지만 검색했습니다. 검색 결과가 누락될 수 있습니다.` } : {}),
  };
}

async function listQueue(mall: string, search: string, rows: QueueRow[]) {
  const targets = rows.filter((row) => row.mall_id === mall);
  const fetched = await Promise.all(targets.map(async (row) => {
    try {
      const response = await api(mall, `products/${row.product_no}`) as {
        product?: Cafe24Product;
      };
      return response.product || null;
    } catch (error) {
      console.error("해제 예정 상품 조회 실패", {
        mall,
        product_no: row.product_no,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }));
  return fetched.filter((p): p is Cafe24Product => p !== null)
    .filter((p) => matchesKeyword(p, search));
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const requested = req.nextUrl.searchParams.get("mall") || "all";
    const search = (req.nextUrl.searchParams.get("q") || "").trim();
    const rawPage = Number(req.nextUrl.searchParams.get("page") || "1");
    const page = Number.isFinite(rawPage)
      ? Math.max(1, Math.min(200, Math.floor(rawPage)))
      : 1;
    const rawMode = req.nextUrl.searchParams.get("mode");
    const mode: Mode = rawMode === "queue" ? "queue" : rawMode === "resume" ? "resume" : "stop";
    if (requested !== "all") mallId(requested);

    const { data: malls, error: mallsError } = await db()
      .from("cafe24_malls")
      .select("mall_id")
      .order("mall_id");
    if (mallsError) throw mallsError;

    const ids = (malls || []).map((row) => row.mall_id)
      .filter((id) => requested === "all" || id === requested);
    if (ids.length === 0) {
      return NextResponse.json({
        products: [],
        errors: ["연결된 쇼핑몰이 없습니다."],
        page,
        hasMore: false,
      });
    }

    let queueRows: QueueRow[] = [];
    if (mode === "queue") {
      const { data, error } = await db()
        .from("cafe24_release_queue")
        .select("mall_id,product_no");
      if (error) throw error;
      queueRows = (data || []) as QueueRow[];
    }

    const results = await Promise.all(ids.map(async (mall) => {
      try {
        if (mode === "queue") {
          const items = await listQueue(mall, search, queueRows);
          return { products: items.map((p) => normalizeProduct(mall, p)), hasMore: false, errors: [] as string[] };
        }
        const result = await listByStatus(mall, mode, page, search);
        return {
          products: result.products.map((p) => normalizeProduct(mall, p)),
          hasMore: result.hasMore,
          errors: result.warning ? [result.warning] : [] as string[],
        };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`[${mall}] 상품 조회 실패`, detail);
        return { products: [] as Product[], hasMore: false, errors: [`${mall} 상품 조회 실패: ${detail}`] };
      }
    }));

    return NextResponse.json({
      products: results.flatMap((result) => result.products),
      errors: results.flatMap((result) => result.errors),
      page,
      hasMore: results.some((result) => result.hasMore),
    });
  } catch (error) {
    console.error("GET /api/products 오류", error);
    return fail(error);
  }
}
