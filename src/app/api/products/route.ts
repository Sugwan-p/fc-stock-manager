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

type QueueRow = {
  mall_id: string;
  product_no: number;
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

function normalizeProduct(
  mall: string,
  product: Cafe24Product
): Product {
  return {
    mall,
    product_no: Number(product.product_no),
    product_code: String(product.product_code || ""),
    custom_product_code: String(
      product.custom_product_code || ""
    ),
    product_name: String(product.product_name || ""),
    selling: product.selling === "T",
    display: product.display === "T",
    price_content: String(product.price_content || ""),
  };
}

function uniqueProducts(
  products: Cafe24Product[]
): Cafe24Product[] {
  const map = new Map<number, Cafe24Product>();

  for (const product of products) {
    const productNo = Number(product.product_no);

    if (Number.isSafeInteger(productNo) && productNo > 0) {
      map.set(productNo, product);
    }
  }

  return Array.from(map.values());
}

async function fetchProducts(
  mall: string,
  page: number,
  search: string
): Promise<Cafe24Product[]> {
  const limit = 50;
  const offset = (page - 1) * limit;

  if (!search) {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });

    const response = (await api(
      mall,
      `products?${params.toString()}`
    )) as {
      products?: Cafe24Product[];
    };

    return response.products || [];
  }

  // 상품명 / 자체 상품코드 / 카페24 상품코드
  // 각각 조회한 결과를 합쳐 중복 제거합니다.
  const searchFields = [
    "product_name",
    "custom_product_code",
    "product_code",
  ] as const;

  const results = await Promise.allSettled(
    searchFields.map(async (field) => {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });

      params.set(field, search);

      const response = (await api(
        mall,
        `products?${params.toString()}`
      )) as {
        products?: Cafe24Product[];
      };

      return response.products || [];
    })
  );

  const products: Cafe24Product[] = [];
  const errors: string[] = [];

  for (let index = 0; index < results.length; index++) {
    const result = results[index];

    if (result.status === "fulfilled") {
      products.push(...result.value);
    } else {
      const message =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);

      errors.push(`${searchFields[index]}: ${message}`);
    }
  }

  if (errors.length === searchFields.length) {
    throw new Error(
      `상품 검색 API 요청이 모두 실패했습니다. ${errors.join(" / ")}`
    );
  }

  if (errors.length > 0) {
    console.warn(
      `[${mall}] 일부 상품 검색 조건 실패:`,
      errors
    );
  }

  return uniqueProducts(products);
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
      ? Math.max(
          1,
          Math.min(10000, Math.floor(rawPage))
        )
      : 1;

    const queueMode =
      req.nextUrl.searchParams.get("mode") === "queue";

    if (requested !== "all") {
      mallId(requested);
    }

    const { data: malls, error: mallsError } = await db()
      .from("cafe24_malls")
      .select("mall_id")
      .order("mall_id");

    if (mallsError) {
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
        errors: ["연결된 쇼핑몰이 없습니다."],
        page,
      });
    }

    let queueRows: QueueRow[] = [];

    if (queueMode) {
      const { data, error } = await db()
        .from("cafe24_release_queue")
        .select("mall_id,product_no");

      if (error) {
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
                    `[${mall}] 상품 ${item.product_no} 조회 실패:`,
                    error
                  );

                  return null;
                }
              })
            );

            products = fetched.filter(
              (item): item is Cafe24Product =>
                item !== null
            );

            if (search) {
              const keyword = search.toLowerCase();

              products = products.filter((product) =>
                [
                  product.product_name,
                  product.product_code,
                  product.custom_product_code,
                ].some((value) =>
                  String(value || "")
                    .toLowerCase()
                    .includes(keyword)
                )
              );
            }
          } else {
            products = await fetchProducts(
              mall,
              page,
              search
            );
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
            `[${mall}] 상품 조회 실패:`,
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