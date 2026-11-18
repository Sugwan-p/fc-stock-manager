import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
const COOKIE = 'fc_admin';
function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET은 32자 이상이어야 합니다.');
  return s;
}
function sign(value: string) { return createHmac('sha256', secret()).update(value).digest('hex'); }
function equal(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function verifyPassword(password: string) {
  const expected = process.env.ADMIN_PASSWORD;
  return Boolean(expected && expected.length >= 12 && equal(password, expected));
}
export async function loggedIn() {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return false;
  const [exp, nonce, mac] = raw.split('.');
  if (!exp || !nonce || !mac || !/^\d+$/.test(exp)) return false;
  return Number(exp) > Date.now() && equal(mac, sign(`${exp}.${nonce}`));
}
export async function setSession() {
  const exp = String(Date.now() + 7 * 24 * 3600 * 1000);
  const nonce = randomBytes(16).toString('hex');
  (await cookies()).set(COOKIE, `${exp}.${nonce}.${sign(`${exp}.${nonce}`)}`, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 7 * 24 * 3600
  });
}
export async function clearSession() { (await cookies()).delete(COOKIE); }
export async function requireAdmin() { if (!(await loggedIn())) throw new Error('UNAUTHORIZED'); }
