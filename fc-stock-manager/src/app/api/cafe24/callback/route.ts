import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { loggedIn } from '@/lib/auth';
import { exchange, saveTokens } from '@/lib/cafe24';
function equal(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
export async function GET(req: NextRequest) {
  const destination = new URL('/', req.url);
  const cookie = req.cookies.get('fc_oauth')?.value || '';
  const [mall, saved] = cookie.split(':');
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const res = (status: string) => {
    destination.searchParams.set('oauth', status);
    const r = NextResponse.redirect(destination);
    r.cookies.delete('fc_oauth');
    return r;
  };
  if (!(await loggedIn()) || !mall || !saved || !code || !state || !equal(saved, state)) return res('error');
  try { await saveTokens(mall, await exchange(mall, code)); return res('success'); }
  catch { return res('error'); }
}
