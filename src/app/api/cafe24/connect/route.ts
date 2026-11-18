import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { loggedIn } from '@/lib/auth';
import { authorizeUrl, mallId } from '@/lib/cafe24';
export async function GET(req: NextRequest) {
  if (!(await loggedIn())) return NextResponse.redirect(new URL('/', req.url));
  try {
    const mall = mallId(req.nextUrl.searchParams.get('mall') || '');
    const state = randomBytes(24).toString('hex');
    const res = NextResponse.redirect(authorizeUrl(mall, state));
    res.cookies.set('fc_oauth', `${mall}:${state}`, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 600, path: '/api/cafe24' });
    return res;
  } catch { return NextResponse.redirect(new URL('/?error=mall', req.url)); }
}
