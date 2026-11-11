# 연이음 웹

React·TypeScript·Vite로 구현한 한국어 조직·권한 로컬 프로토타입이다. `src/features/access`에 실제 API와 연결된 로그인·대시보드·담당자 등록·역할 관리·감사 화면을 두고 `src/shared`에 API 계약을 둔다.

저장소 루트에서 `npm ci --prefix apps/web`, `npm run dev --prefix apps/web`를 실행한다. API도 별도 실행해야 한다. Node 24, 패키지 의존성은 `package-lock.json`으로 고정한다. Vite는 127.0.0.1:5173에서 `/api`를 로컬 FastAPI로 프록시한다.

`npm run build --prefix apps/web`는 타입 검사와 번들 빌드, `npm run format:check --prefix apps/web`는 Prettier 검사, `npm run test:e2e --prefix apps/web`는 실제 브라우저 흐름 검사다. 자세한 설정은 [프로토타입 가이드](../../docs/PROTOTYPE.md)를 따른다.

자료실·예산·인수인계 화면은 아직 없고 다음 구현 범위로 표시한다. 실행 자산에 학교 문서·영수증을 넣지 않는다. 쿠키 기반 세션은 로컬 시연용이며 운영 인증 검증과 구분한다.
