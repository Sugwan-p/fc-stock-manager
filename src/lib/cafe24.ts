
import "server-only";

import { db } from "./db";
import { encrypt, decrypt } from "./crypto";

export const SCOPES = "mall.read_product,mall.write_product";

export function mallId(raw: string): string {
  const id = raw.trim().toLowerCase();

  if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(id)) {
    throw new Error("BAD_REQUEST");
  }

  return id;
}

function config() {
  const id = process.env.CAFE24_CLIENT_ID;
  const secret = process.env.CAFE24_CLIENT_SECRET;
  const redirect = process.env.CAFE24_REDIRECT_URI;

  if (!id || !secret || !redirect) {
    throw new Error("카페24 환경변수가 누락되었습니다.");
  }

  return { id, secret, redirect };
}

export function authorizeUrl(
  mall: string,
  state: string
): string {
  const c = config();
  const id = mallId(mall);

  const url = new URL(
    `https://${id}.cafe24api.com/api/v2/oauth/authorize`
  );

  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", c.id);
  url.searchParams.set("redirect_uri", c.redirect);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);

  return url.toString();
}

type Token = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  refresh_token_expires_at: string;
  mall_id?: string;
};

type MallRow = {
  mall_id: string;
  access_token_enc: string;
  refresh_token_enc: string;
  access_expires_at: string;
  refresh_expires_at: string;
};

async function tokenRequest(
  mall: string,
  params: URLSearchParams
): Promise<Token> {
  const c = config();
  const id = mallId(mall);

  const response = await fetch(
    `https://${id}.cafe24api.com/api/v2/oauth/token`,
    {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization:
          `Basic ${Buffer.from(
            `${c.id}:${c.secret}`
          ).toString("base64")}`,
        "Content-Type":
          "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    }
  );

  if (!response.ok) {
    // 토큰 및 인증 코드는 로그에 출력하지 않습니다.
    console.error("카페24 토큰 요청 실패", {
      mall: id,
      status: response.status,
    });

    throw new Error(
      `카페24 토큰 요청 실패 (HTTP ${response.status})`
    );
  }

  const result: unknown = await response.json();

  if (!result || typeof result !== "object") {
    throw new Error("카페24 토큰 응답 형식 오류");
  }

  const token = result as Partial<Token>;

  if (
    !token.access_token ||
    !token.refresh_token ||
    !token.expires_at ||
    !token.refresh_token_expires_at
  ) {
    throw new Error("카페24 토큰 응답에 필수 값이 없습니다.");
  }

  if (
    token.mall_id &&
    mallId(token.mall_id) !== id
  ) {
    throw new Error("카페24 쇼핑몰 ID가 일치하지 않습니다.");
  }

  return token as Token;
}

export async function exchange(
  mall: string,
  code: string
): Promise<Token> {
  const c = config();

  return tokenRequest(
    mall,
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: c.redirect,
    })
  );
}

export async function saveTokens(
  mall: string,
  token: Token
): Promise<void> {
  const id = mallId(mall);

  const { error } = await db()
    .from("cafe24_malls")
    .upsert(
      {
        mall_id: id,
        access_token_enc: encrypt(
          token.access_token
        ),
        refresh_token_enc: encrypt(
          token.refresh_token
        ),
        access_expires_at: token.expires_at,
        refresh_expires_at:
          token.refresh_token_expires_at,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "mall_id",
      }
    );

  if (error) {
    console.error("카페24 토큰 저장 실패", {
      mall: id,
      code: error.code,
      message: error.message,
    });

    throw new Error(
      `쇼핑몰 토큰 저장 실패: ${error.message}`
    );
  }
}

async function row(mall: string): Promise<MallRow> {
  const id = mallId(mall);

  const { data, error } = await db()
    .from("cafe24_malls")
    .select(
      "mall_id,access_token_enc,refresh_token_enc,access_expires_at,refresh_expires_at"
    )
    .eq("mall_id", id)
    .single();

  if (error || !data) {
    if (error) {
      console.error("쇼핑몰 토큰 조회 실패", {
        mall: id,
        code: error.code,
        message: error.message,
      });
    }

    throw new Error(
      "쇼핑몰 연결 정보를 찾을 수 없습니다. 다시 연결해주세요."
    );
  }

  return data as MallRow;
}

export async function accessToken(
  mall: string
): Promise<string> {
  const id = mallId(mall);

  // 여러 요청에서 토큰 갱신이 경합할 때
  // 무한 재귀를 방지합니다.
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await row(id);

    const accessExpiresAt = new Date(
      current.access_expires_at
    ).getTime();

    if (
      Number.isFinite(accessExpiresAt) &&
      accessExpiresAt > Date.now() + 5 * 60_000
    ) {
      return decrypt(current.access_token_enc);
    }

    const refreshExpiresAt = new Date(
      current.refresh_expires_at
    ).getTime();

    if (
      !Number.isFinite(refreshExpiresAt) ||
      refreshExpiresAt <= Date.now()
    ) {
      throw new Error(
        "카페24 Refresh Token이 만료되었습니다. 쇼핑몰을 다시 연결해주세요."
      );
    }

    const latest = await row(id);

    if (
      latest.refresh_token_enc !==
      current.refresh_token_enc
    ) {
      continue;
    }

    const token = await tokenRequest(
      id,
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: decrypt(
          current.refresh_token_enc
        ),
      })
    );

    const { data, error } = await db()
      .from("cafe24_malls")
      .update({
        access_token_enc: encrypt(
          token.access_token
        ),
        refresh_token_enc: encrypt(
          token.refresh_token
        ),
        access_expires_at: token.expires_at,
        refresh_expires_at:
          token.refresh_token_expires_at,
        updated_at: new Date().toISOString(),
      })
      .eq("mall_id", id)
      .eq(
        "refresh_token_enc",
        current.refresh_token_enc
      )
      .select("mall_id");

    if (error) {
      console.error("카페24 토큰 갱신 저장 실패", {
        mall: id,
        code: error.code,
        message: error.message,
      });

      throw new Error(
        "카페24 갱신 토큰 저장에 실패했습니다."
      );
    }

    if (data && data.length > 0) {
      return token.access_token;
    }
  }

  throw new Error(
    "동시 토큰 갱신이 발생했습니다. 잠시 후 다시 시도해주세요."
  );
}

export async function api(
  mall: string,
  path: string,
  init?: {
    method?: string;
    body?: unknown;
  }
): Promise<any> {
  const id = mallId(mall);
  const token = await accessToken(id);

  const cleanPath = path.replace(/^\/+/, "");

  const response = await fetch(
    `https://${id}.cafe24api.com/api/v2/admin/${cleanPath}`,
    {
      method: init?.method || "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Cafe24-Api-Version": "2025-06-01",
      },
      body:
        init?.body === undefined
          ? undefined
          : JSON.stringify(init.body),
    }
  );

  const data: unknown = await response
    .json()
    .catch(() => ({}));

  if (!response.ok) {
    // 응답 본문에 민감한 정보가 있을 수 있으므로
    // 서버 로그에는 상태 코드와 경로만 기록합니다.
    console.error("카페24 Admin API 오류", {
      mall: id,
      path: cleanPath.split("?")[0],
      status: response.status,
    });

    throw new Error(
      `Cafe24 API 요청 실패 (HTTP ${response.status})`
    );
  }

  return data;
}
