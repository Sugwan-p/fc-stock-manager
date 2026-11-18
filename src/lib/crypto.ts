import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
function key() {
  const hex = process.env.TOKEN_ENCRYPTION_KEY || '';
  if (!/^[a-fA-F0-9]{64}$/.test(hex)) throw new Error('TOKEN_ENCRYPTION_KEY는 64자리 hex여야 합니다.');
  return Buffer.from(hex, 'hex');
}
export function encrypt(s: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(s, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map(x => x.toString('base64url')).join('.');
}
export function decrypt(s: string) {
  const [iv, tag, data] = s.split('.');
  if (!iv || !tag || !data) throw new Error('암호화 데이터 오류');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}
