
import "server-only";

import { db } from "./db";
import { encrypt, decrypt } from "./crypto";

export const SCOPES = "mall.read_product,mall.write_product";

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

type ApiOptions = {
  method?: string;
  body?: unknown;
};

type ApiErrorDetails = {
  code: string;
  message: string;
};

const ACCESS_REFRESH_BUFFER_MS = 10 * 60 * 1000;
const MAX_REFRESH_ATTEMPTS = 4;

// 같은 서버 인스턴스에서 동시에 발생하는
// 동일 쇼핑몰 토큰 갱신 요청을 하나로 묶습니다.
const refreshJobs = new Map<string, Promise<string>>();

export function mallId(raw: string): string {
  const id = raw.trim().toLowerCase();

  if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(id)) {
    throw new Error("BAD_REQUEST");
  }

  return id;
}

function config(mall: string) {
  const id = mallId(mall);
  const redirect = process.env.CAFE24_REDIRECT_URI;

  let clientId: string | undefined;
  let clientSecret: string | undefined;

  if (id === "dainstore") {
    clientId = process.env.CAFE24_CLIENT_ID;
    clientSecret = process.env.CAFE24_CLIENT_SECRET;
  } else if (id === "dainfp") {
    clientId = process.env.CAFE24_SECOND_CLIENT_ID;
    clientSecret = process.env.CAFE24_SECOND_CLIENT_SECRET;
  } else {
    throw new Error(`등록되지 않은 쇼핑몰 ID: ${id}`);
  }

  if (!clientId || !clientSecret || !redirect) {
    throw new Error(
      `${id} 카페24 API 환경변수가 누락되었습니다.`
    );
  }

  return {
    id: clientId,
    secret: clientSecret,
    redirect,
  };
}

function cafe24Url(mall: string, path: string): string {
  const id = mallId(mall);

  return `https://${id}.cafe24api.com/api/v2/${path}`;
}

export function authorizeUrl(
  mall: string,
  state: string
): string {
  const id = mallId(mall);
  const c = config(id);

  const url = new URL(cafe24Url(id, "oauth/authorize"));

  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", c.id);
  url.searchParams.set("redirect_uri", c.redirect);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);

  return url.toString();
}

async function tokenRequest(
  mall: string,
  params: URLSearchParams
): Promise<Token> {
  const id = mallId(mall);
  const c = config(id);

  const response = await fetch(
    cafe24Url(id, "oauth/token"),
    {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${c.id}:${c.secret}`
        ).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    }
  );

  if (!response.ok) {
    console.error("카페24 토큰 요청 실패", {
      mall: id,
      status: response.status,
    });

    throw new Error(
      `${id} 카페24 토큰 갱신 실패 (HTTP ${response.status}). ` +
        "Refresh Token 또는 앱 인증정보를 확인해주세요."
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
    throw new Error(
      "카페24 토큰 응답에 필수 값이 없습니다."
    );
  }

  if (token.mall_id && mallId(token.mall_id) !== id) {
    throw new Error("카페24 쇼핑몰 ID가 일치하지 않습니다.");
  }

  return token as Token;
}

export async function exchange(
  mall: string,
  code: string
): Promise<Token> {
  const c = config(mall);

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
        access_token_enc: encrypt(token.access_token),
        refresh_token_enc: encrypt(token.refresh_token),
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

    throw new Error("쇼핑몰 토큰 저장 실패");
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
    console.error("쇼핑몰 토큰 조회 실패", {
      mall: id,
      code: error?.code,
      message: error?.message,
    });

    throw new Error(
      `${id} 쇼핑몰 연결 정보를 찾을 수 없습니다.`
    );
  }

  return data as MallRow;
}

function isAccessValid(current: MallRow): boolean {
  const expiresAt = new Date(
    current.access_expires_at
  ).getTime();

  return (
    Number.isFinite(expiresAt) &&
    expiresAt > Date.now() + ACCESS_REFRESH_BUFFER_MS
  );
}

function ensureRefreshValid(current: MallRow): void {
  const expiresAt = new Date(
    current.refresh_expires_at
  ).getTime();

  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    throw new Error(
      `${current.mall_id} Refresh Token이 만료되었습니다. ` +
        "쇼핑몰을 다시 연결해주세요."
    );
  }
}

/**
 * force=false:
 *   DB 만료 시각을 기준으로 필요할 때만 갱신합니다.
 *
 * force=true:
 *   카페24가 401을 반환하면 DB 만료 시각과 관계없이
 *   토큰 갱신을 시도합니다.
 *
 * failedAccessToken:
 *   다른 요청에서 이미 토큰을 교체했으면
 *   갱신하지 않고 새로운 토큰을 재사용합니다.
 */
async function refreshAccessToken(
  mall: string,
  force: boolean,
  failedAccessToken?: string
): Promise<string> {
  const id = mallId(mall);

  for (
    let attempt = 0;
    attempt < MAX_REFRESH_ATTEMPTS;
    attempt++
  ) {
    const current = await row(id);
    const currentAccessToken = decrypt(
      current.access_token_enc
    );

    // 다른 요청이 이미 새 토큰을 저장했다면
    // 기존 토큰을 다시 갱신하지 않습니다.
    if (
      failedAccessToken &&
      currentAccessToken !== failedAccessToken
    ) {
      return currentAccessToken;
    }

    if (!force && isAccessValid(current)) {
      return currentAccessToken;
    }

    ensureRefreshValid(current);

    // 최신 DB 상태를 다시 확인합니다.
    const latest = await row(id);

    if (
      latest.refresh_token_enc !==
      current.refresh_token_enc
    ) {
      continue;
    }

    const latestAccessToken = decrypt(
      latest.access_token_enc
    );

    if (
      failedAccessToken &&
      latestAccessToken !== failedAccessToken
    ) {
      return latestAccessToken;
    }

    if (!force && isAccessValid(latest)) {
      return latestAccessToken;
    }

    const newToken = await tokenRequest(
      id,
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: decrypt(
          latest.refresh_token_enc
        ),
      })
    );

    // 기존 refresh_token_enc가 일치할 때만 갱신합니다.
    // 다른 요청이 먼저 갱신한 경우 덮어쓰지 않습니다.
    const { data, error } = await db()
      .from("cafe24_malls")
      .update({
        access_token_enc: encrypt(
          newToken.access_token
        ),
        refresh_token_enc: encrypt(
          newToken.refresh_token
        ),
        access_expires_at: newToken.expires_at,
        refresh_expires_at:
          newToken.refresh_token_expires_at,
        updated_at: new Date().toISOString(),
      })
      .eq("mall_id", id)
      .eq(
        "refresh_token_enc",
        latest.refresh_token_enc
      )
      .select("mall_id");

    if (error) {
      console.error("카페24 토큰 갱신 저장 실패", {
        mall: id,
        code: error.code,
        message: error.message,
      });

      throw new Error(
        `${id} 카페24 토큰 갱신 저장에 실패했습니다.`
      );
    }

    if (data && data.length > 0) {
      console.info("카페24 액세스 토큰 자동 갱신 완료", {
        mall: id,
      });

      return newToken.access_token;
    }

    // 다른 서버 요청이 먼저 저장한 경우
    // 다음 반복에서 최신 토큰을 확인합니다.
  }

  throw new Error(
    `${id} 동시 토큰 갱신 충돌이 발생했습니다. ` +
      "잠시 후 다시 시도해주세요."
  );
}

/**
 * 동일 서버 인스턴스의 중복 갱신 방지.
 *
 * Vercel의 서로 다른 인스턴스까지 완전히 잠그는
 * 분산 락은 아니므로, 매우 드문 동시 갱신 충돌은
 * 별도 DB 락 설계가 필요할 수 있습니다.
 */
async function refreshOnce(
  mall: string,
  force = false,
  failedAccessToken?: string
): Promise<string> {
  const id = mallId(mall);

  const existing = refreshJobs.get(id);

  if (existing) {
    await existing;

    // 대기 후 최신 DB 토큰을 확인합니다.
    const current = await row(id);
    const token = decrypt(current.access_token_enc);

    if (
      failedAccessToken &&
      token !== failedAccessToken
    ) {
      return token;
    }

    if (!force && isAccessValid(current)) {
      return token;
    }

    // 기존 작업이 끝났지만 같은 실패 토큰이 남아
    // 있다면 아래에서 새 갱신을 진행합니다.
  }

  const job = refreshAccessToken(
    id,
    force,
    failedAccessToken
  );

  refreshJobs.set(id, job);

  try {
    return await job;
  } finally {
    if (refreshJobs.get(id) === job) {
      refreshJobs.delete(id);
    }
  }
}

export async function accessToken(
  mall: string
): Promise<string> {
  const id = mallId(mall);
  const current = await row(id);

  if (isAccessValid(current)) {
    return decrypt(current.access_token_enc);
  }

  return refreshOnce(id);
}

function getApiErrorDetails(
  data: unknown
): ApiErrorDetails {
  if (!data || typeof data !== "object") {
    return {
      code: "",
      message: "상세 오류 메시지가 없습니다.",
    };
  }

  const details = data as Record<string, unknown>;

  const errorObject =
    details.error &&
    typeof details.error === "object"
      ? (details.error as Record<string, unknown>)
      : null;

  const code =
    typeof errorObject?.code === "string"
      ? errorObject.code
      : typeof details.code === "string"
        ? details.code
        : "";

  const message =
    typeof errorObject?.message === "string"
      ? errorObject.message
      : typeof details.message === "string"
        ? details.message
        : "상세 오류 메시지가 없습니다.";

  return { code, message };
}

function isInvalidToken(
  status: number,
  details: ApiErrorDetails
): boolean {
  if (status !== 401) {
    return false;
  }

  const text =
    `${details.code} ${details.message}`.toLowerCase();

  return (
    text.includes("invalid_token") ||
    text.includes("access_token") ||
    text.includes("token expired") ||
    text.includes("token time expired")
  );
}

async function sendApiRequest(
  mall: string,
  path: string,
  token: string,
  init?: ApiOptions
): Promise<{
  response: Response;
  data: unknown;
}> {
  const id = mallId(mall);
  const cleanPath = path.replace(/^\/+/, "");

  const url = new URL(
    cafe24Url(id, `admin/${cleanPath}`)
  );

  const response = await fetch(url.toString(), {
    method: init?.method || "GET",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body:
      init?.body === undefined
        ? undefined
        : JSON.stringify(init.body),
  });

  const data: unknown = await response
    .json()
    .catch(() => ({}));

  return { response, data };
}

/**
 * 카페24 Admin API 공통 호출 함수.
 *
 * 1. 유효한 액세스 토큰 확보
 * 2. API 요청
 * 3. 401 토큰 오류 발생 시 강제 갱신
 * 4. 새 토큰으로 요청 1회 재시도
 */
export async function api(
  mall: string,
  path: string,
  init?: ApiOptions
): Promise<any> {
  const id = mallId(mall);
  let token = await accessToken(id);

  let { response, data } = await sendApiRequest(
    id,
    path,
    token,
    init
  );

  let details = getApiErrorDetails(data);

  if (isInvalidToken(response.status, details)) {
    console.warn(
      "카페24 액세스 토큰 오류 감지, 자동 갱신 시도",
      {
        mall: id,
        status: response.status,
      }
    );

    // 현재 요청에 사용했던 토큰을 전달하여
    // 다른 요청이 이미 갱신한 경우 중복 갱신을 방지합니다.
    token = await refreshOnce(id, true, token);

    const retry = await sendApiRequest(
      id,
      path,
      token,
      init
    );

    response = retry.response;
    data = retry.data;
    details = getApiErrorDetails(data);
  }

  if (!response.ok) {
    console.error("카페24 Admin API 상세 오류", {
      mall: id,
      path: path.split("?")[0],
      status: response.status,
      errorCode: details.code,
      errorMessage: details.message,
    });

    throw new Error(
      `Cafe24 HTTP ${response.status}: ` +
        `${details.code} ${details.message}`
    );
  }

  return data;
}
