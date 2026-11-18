
import "server-only";

import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { cookies } from "next/headers";

const COOKIE = "fc_admin";

// 세션 암호화 키
function secret() {
  const s = process.env.SESSION_SECRET;

  if (!s || s.length < 32) {
    throw new Error(
      "SESSION_SECRET은 32자 이상이어야 합니다."
    );
  }

  return s;
}

// 세션 서명 생성
function sign(value: string) {
  return createHmac("sha256", secret())
    .update(value)
    .digest("hex");
}

// 안전한 문자열 비교
function equal(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);

  return (
    x.length === y.length &&
    timingSafeEqual(x, y)
  );
}

// 관리자 비밀번호 검증
export function verifyPassword(password: string) {
  const expected = process.env.ADMIN_PASSWORD;

  if (!expected) {
    return false;
  }

  // 로컬 개발 환경에서만 짧은 테스트 비밀번호 허용
  if (process.env.NODE_ENV === "development") {
    return equal(password, expected);
  }

  // 실제 배포 환경에서는 12자리 이상 필수
  if (expected.length < 12) {
    return false;
  }

  return equal(password, expected);
}

// 로그인 여부 확인
export async function loggedIn() {
  const raw = (await cookies()).get(COOKIE)?.value;

  if (!raw) {
    return false;
  }

  const [exp, nonce, mac] = raw.split(".");

  if (!exp || !nonce || !mac || !/^\d+$/.test(exp)) {
    return false;
  }

  return (
    Number(exp) > Date.now() &&
    equal(mac, sign(`${exp}.${nonce}`))
  );
}

// 로그인 세션 생성
export async function setSession() {
  const exp = String(
    Date.now() + 7 * 24 * 3600 * 1000
  );

  const nonce = randomBytes(16).toString("hex");

  (await cookies()).set(
    COOKIE,
    `${exp}.${nonce}.${sign(`${exp}.${nonce}`)}`,
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 3600,
    }
  );
}

// 로그아웃
export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

// 관리자 인증 확인
export async function requireAdmin() {
  if (!(await loggedIn())) {
    throw new Error("UNAUTHORIZED");
  }
}
