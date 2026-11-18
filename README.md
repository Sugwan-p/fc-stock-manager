# FC 상품 품절관리

Next.js 15 / TypeScript / Tailwind CSS 4 / Supabase / Cafe24 Admin API

## 설치

1. `npm install`
2. Supabase SQL Editor에서 `supabase/schema.sql` 실행
3. `.env.example`을 `.env.local`로 복사하고 실제 값 입력
4. `TOKEN_ENCRYPTION_KEY`: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
5. `SESSION_SECRET`: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
6. `npm run dev`
7. GitHub 저장소에 올린 후 Vercel에서 Import, 환경변수 등록, Deploy
8. 기존 카페24 앱의 기존 Redirect URI는 유지하고 새 배포 도메인의 `/api/cafe24/callback`만 추가
9. 앱에서 관리자 로그인 후 두 쇼핑몰 각각 OAuth 연결

## 운영 전 필수 확인

- `selling=F/T`는 판매안함/판매함이며 실제 재고 품절과 다릅니다.
- 판매가 대체문구 사용 체크박스는 이 앱에서 제어하지 않습니다. 문구 필드만 수정합니다.
- 토큰 자동 갱신은 API 요청 시 수행됩니다. 14일 이상 미사용 시 재연결이 필요할 수 있습니다.
- 동시에 같은 쇼핑몰 토큰 갱신 요청이 발생하면 경합 가능성이 있습니다. 고빈도 운영 전 DB 잠금/RPC 기반 갱신을 추가하세요.
- 단일 관리자 비밀번호 방식입니다. 운영 시 로그인 시도 제한, CSRF 방어, 접근 IP 제한, 관리자 계정 관리, 감사 로그 등을 추가하세요.
- 상품 조회는 카페24 API의 상품명 검색 및 페이지네이션을 사용합니다. 실제 운영 쇼핑몰에서 검색 동작을 검증하세요.
- 대량 수정은 상품별 개별 호출이며 API 호출 제한이 적용될 수 있습니다. 소량 테스트 후 사용하세요.
- Cafe24 API 버전/필드 지원은 실제 앱에서 확인해야 합니다.
