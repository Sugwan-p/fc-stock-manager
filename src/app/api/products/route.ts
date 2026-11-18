import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { api, mallId } from "@/lib/cafe24";
import { db } from "@/lib/db";
import { fail } from "@/lib/http";

type Cafe24Product = {
  product_no?: number | string;
  product_code?: string;
  product_name?: string;
  selling?: string;
  display?: string;
  price_content?: string;
};

type QueueRow = {
  mall_id: string;
  product_no: number;
};

type Product = {
  mall: string;
  product_no: number;
  product_code: string;
  product_name: string;
  selling: boolean;
  display: boolean;
  price_content: string;
};

function normalizeProduct(
  mall: string,
  product: Cafe24Product
): Product {
  return {
    mall,
    product_no: Number(product.product_no),
    product_code: String(product.product_code || ""),
    product_name: String(product.product_name || ""),
    selling: product.selling === "T",
    display: product.display === "T",
    price_content: String(product.price_content || ""),
  };
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();

    const requested =
      req.nextUrl.searchParams.get("mall") || "all";

    const search =
      (req.nextUrl.searchParams.get("q") || "").trim();

    const rawPage = Number(
      req.nextUrl.searchParams.get("page") || "1"
    );

    const page = Number.isFinite(rawPage)
      ? Math.max(1, Math.min(10000, Math.floor(rawPage)))
      : 1;

    const queueMode =
      req.nextUrl.searchParams.get("mode") === "queue";

    if (requested !== "all") {
      mallId(requested);
    }

    // 실제 Supabase 테이블명 사용
    const { data: malls, error: mallsError } = await db()
      .from("cafe24_malls")
      .select("mall_id")
      .order("mall_id");

    if (mallsError) {
      console.error("상품 조회 - 쇼핑몰 목록 오류:", mallsError);
      throw mallsError;
    }

    const ids = (malls || [])
      .map((item) => item.mall_id)
      .filter(
        (id) => requested === "all" || id === requested
      );

    if (ids.length === 0) {
      return NextResponse.json({
        products: [],
        errors: [
          requested === "all"
            ? "연결된 쇼핑몰이 없습니다."
            : `${requested} 쇼핑몰이 연결되어 있지 않습니다.`,
        ],
        page,
      });
    }

    let queueRows: QueueRow[] = [];

    if (queueMode) {
      const { data, error } = await db()
        .from("cafe24_release_queue")
        .select("mall_id,product_no");

      if (error) {
        console.error("해제 예정 목록 조회 오류:", error);
        throw error;
      }

      queueRows = (data || []) as QueueRow[];
    }

    const results = await Promise.all(
      ids.map(async (mall) => {
        try {
          let products: Cafe24Product[] = [];

          if (queueMode) {
            const targets = queueRows.filter(
              (item) => item.mall_id === mall
            );

            const fetched = await Promise.all(
              targets.map(async (item) => {
                try {
                  const response = (await api(
                    mall,
                    `products/${item.product_no}`
                  )) as {
                    product?: Cafe24Product;
                  };

                  return response.product || null;
                } catch (error) {
                  console.error(
                    `[${mall}] 상품번호 ${item.product_no} 조회 오류:`,
                    error
                  );

                  return null;
                }
              })
            );

            products = fetched.filter(
              (item): item is Cafe24Product => item !== null
            );
          } else {
            const params = new URLSearchParams({
              limit: "50",
              offset: String((page - 1) * 50),
            });

            // 검색어가 있을 때 상품명 검색
            if (search) {
              params.set("product_name", search);
            }

            const response = (await api(
              mall,
              `products?${params.toString()}`
            )) as {
              products?: Cafe24Product[];
            };

            products = response.products || [];
          }

          return {
            mall,
            products: products.map((product) =>
              normalizeProduct(mall, product)
            ),
            error: "",
          };
        } catch (error) {
          const detail =
            error instanceof Error
              ? error.message
              : String(error);

          console.error(
            `[${mall}] 카페24 상품 조회 실패:`,
            detail
          );

          return {
            mall,
            products: [] as Product[],
            error: `${mall} 상품 조회 실패: ${detail}`,
          };
        }
      })
    );

    return NextResponse.json({
      products: results.flatMap(
        (result) => result.products
      ),
      errors: results
        .filter((result) => result.error)
        .map((result) => result.error),
      page,
    });
  } catch (error) {
    console.error("GET /api/products 오류:", error);
    return fail(error);
  }
}