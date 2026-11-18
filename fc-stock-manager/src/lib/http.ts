import { NextResponse } from 'next/server';
export function fail(e: unknown) {
  const message = e instanceof Error ? e.message : '요청 처리 실패';
  const status = message === 'UNAUTHORIZED' ? 401 : message === 'BAD_REQUEST' ? 400 : 500;
  // 인증정보나 API 응답 원문을 클라이언트에 노출하지 않습니다.
  return NextResponse.json({ error: status === 401 ? '로그인이 필요합니다.' : status === 400 ? '요청 값이 올바르지 않습니다.' : '처리 중 오류가 발생했습니다. 서버 설정과 API 권한을 확인하세요.' }, { status });
}
