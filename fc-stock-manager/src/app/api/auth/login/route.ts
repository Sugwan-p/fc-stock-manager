import { NextRequest, NextResponse } from 'next/server';
import { verifyPassword, setSession } from '@/lib/auth';
export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({ password: '' }));
  if (typeof password !== 'string' || !verifyPassword(password)) return NextResponse.json({ error: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
  await setSession();
  return NextResponse.json({ ok: true });
}
