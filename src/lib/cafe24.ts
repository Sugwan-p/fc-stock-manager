import 'server-only';
import { db } from './db';
import { encrypt, decrypt } from './crypto';
export const SCOPES = 'mall.read_product,mall.write_product';
export function mallId(raw: string) {
  const id = raw.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(id)) throw new Error('BAD_REQUEST');
  return id;
}
function config() {
  const id = process.env.CAFE24_CLIENT_ID, secret = process.env.CAFE24_CLIENT_SECRET, redirect = process.env.CAFE24_REDIRECT_URI;
  if (!id || !secret || !redirect) throw new Error('카페24 환경변수 누락');
  return { id, secret, redirect };
}
export function authorizeUrl(mall: string, state: string) {
  const c = config();
  const u = new URL(`https://${mallId(mall)}.cafe24api.com/api/v2/oauth/authorize`);
  Object.entries({ response_type: 'code', client_id: c.id, redirect_uri: c.redirect, scope: SCOPES, state }).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
}
type Token = { access_token: string; refresh_token: string; expires_at: string; refresh_token_expires_at: string; mall_id?: string };
async function tokenRequest(mall: string, params: URLSearchParams): Promise<Token> {
  const c = config();
  const response = await fetch(`https://${mallId(mall)}.cafe24api.com/api/v2/oauth/token`, {
    method: 'POST', cache: 'no-store', headers: { Authorization: `Basic ${Buffer.from(`${c.id}:${c.secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString()
  });
  if (!response.ok) throw new Error(`카페24 토큰 요청 실패 (${response.status})`);
  const t = await response.json() as Partial<Token>;
  if (!t.access_token || !t.refresh_token || !t.expires_at || !t.refresh_token_expires_at || (t.mall_id && t.mall_id !== mall)) throw new Error('카페24 토큰 응답 오류');
  return t as Token;
}
export async function exchange(mall: string, code: string) {
  const c = config();
  return tokenRequest(mall, new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: c.redirect }));
}
export async function saveTokens(mall: string, t: Token) {
  const { error } = await db().from('fc_malls').upsert({ mall_id: mall, access_token_enc: encrypt(t.access_token), refresh_token_enc: encrypt(t.refresh_token), access_expires_at: t.expires_at, refresh_expires_at: t.refresh_token_expires_at, updated_at: new Date().toISOString() }, { onConflict: 'mall_id' });
  if (error) throw new Error('토큰 저장 실패');
}
type MallRow = { mall_id: string; access_token_enc: string; refresh_token_enc: string; access_expires_at: string; refresh_expires_at: string };
async function row(mall: string): Promise<MallRow> {
  const { data, error } = await db().from('fc_malls').select('*').eq('mall_id', mall).single();
  if (error || !data) throw new Error('쇼핑몰 연결이 없습니다.');
  return data as MallRow;
}
export async function accessToken(mall: string): Promise<string> {
  const old = await row(mall);
  if (new Date(old.access_expires_at).getTime() > Date.now() + 5 * 60_000) return decrypt(old.access_token_enc);
  if (new Date(old.refresh_expires_at).getTime() <= Date.now()) throw new Error('쇼핑몰 재연결 필요');
  // 다른 요청에서 이미 갱신했다면 기존 갱신 토큰을 다시 쓰지 않습니다.
  const latest = await row(mall);
  if (latest.refresh_token_enc !== old.refresh_token_enc) return accessToken(mall);
  const t = await tokenRequest(mall, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: decrypt(old.refresh_token_enc) }));
  const { data, error } = await db().from('fc_malls').update({ access_token_enc: encrypt(t.access_token), refresh_token_enc: encrypt(t.refresh_token), access_expires_at: t.expires_at, refresh_expires_at: t.refresh_token_expires_at, updated_at: new Date().toISOString() }).eq('mall_id', mall).eq('refresh_token_enc', old.refresh_token_enc).select('mall_id');
  if (error) throw new Error('토큰 갱신 저장 실패');
  if (!data?.length) return accessToken(mall);
  return t.access_token;
}
export async function api(mall: string, path: string, init?: { method?: string; body?: unknown }) {
  const token = await accessToken(mall);
  const response = await fetch(`https://${mallId(mall)}.cafe24api.com/api/v2/admin/${path}`, {
    method: init?.method || 'GET', cache: 'no-store', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Cafe24-Api-Version': '2025-06-01' },
    body: init?.body ? JSON.stringify(init.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Cafe24 HTTP ${response.status}: ${JSON.stringify(data).slice(0, 250)}`);
  return data;
}
