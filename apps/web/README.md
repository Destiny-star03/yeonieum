# 연이음 웹

2026-11-21 예산 보완: 예산·정산에서 선생님은 연도·단체와 연간 예산을 설정하고 현재 책임자의 지출·증빙 권한 동시 부여를 선택한다. 책임자는 ‘지출·증빙 등록’에서 파일 드롭/선택, 직접 금액 입력 또는 Excel/CSV 미리 읽기·합계 확인 후 지출을 기록한다. 단체 현황·사용률·지출별 차감 잔액을 표시한다. `ExpenseDialog.tsx`가 기존 자료실 `FileDropzone`을 재사용하며 실제 지출 저장과 증빙 전송 실패의 재시도를 구분한다. [로컬 계약](../../docs/design/LOCAL_FINANCE_HANDOVER.md)을 따른다.

등록창의 `FileDropzone`은 드래그/파일 선택·교체·제거·선택 단계 검증, `UploadDialog`는 파일명 자동 제목·위치 요약·공개 범위·선택 정보 접기·명시적 저장을 맡는다. 같은 서버 업로드 계약과 권한을 재사용하며 다중/폴더 업로드를 추가하지 않는다.

자료실은 연도/단체 카드에서 중첩 폴더·개인 보관·단체 공유로 탐색한다. `features/documents`의 DocumentLibrary가 화면 상태, FolderDialog가 폴더 생성, LibraryFiles가 카드/목록을 맡으며 기존 등록·상세·버전 UI를 재사용한다. 파일 카드 그림은 형식 표시이고 본문 미리보기는 아니다. 최신 권한은 [자료실 계약](../../docs/design/DOCUMENT_LIBRARY.md)을 따른다.

React·TypeScript·Vite로 구현한 한국어 로컬 프로토타입이다. `src/features/access`에 실제 API와 연결된 로그인·대시보드·담당자 등록·역할 관리·감사 화면을 두고 `src/shared`에 API 계약을 둔다.

저장소 루트에서 `npm ci --prefix apps/web`, `npm run dev --prefix apps/web`를 실행한다. API도 별도 실행해야 한다. Node 24, 패키지 의존성은 `package-lock.json`으로 고정한다. Vite는 127.0.0.1:5173에서 `/api`를 로컬 FastAPI로 프록시한다.

`npm run build --prefix apps/web`는 타입 검사와 번들 빌드, `npm run format:check --prefix apps/web`는 Prettier 검사, `npm run test:e2e --prefix apps/web`는 실제 브라우저 흐름 검사다. 자세한 설정은 [프로토타입 가이드](../../docs/PROTOTYPE.md)를 따른다.

`src/features/documents`에 자료실 목록·분류 검색·파일 등록·상세·버전·휴지통·복원과 선생님의 명시적 일반 자료 범위 설정을 둔다. 사이드바 ‘자료실’에서 접근한다. API 변경 후 기존 서버는 같은 명령으로 재시작하고 기존 DB는 유지한다. [자료실 권한과 제약](../../docs/design/DOCUMENT_LIBRARY.md)을 따른다.

`src/features/calendar`는 대시보드의 일간·주간·월간 캘린더, 편집 패널·검색·반복·드래그·포털 리마인더를 맡는다. [캘린더 계약](../../docs/design/CALENDAR.md)의 로컬 정책을 적용한다.

`src/features/budgets`와 `src/features/handovers`에 로컬 예산·정산 및 인수인계 화면을 둔다. 민감 증빙은 별도 회계 권한으로만 다룬다. [구현 범위](../../docs/design/LOCAL_FINANCE_HANDOVER.md)를 따른다. 실행 자산에 학교 문서·영수증을 넣지 않는다. 쿠키 기반 세션은 로컬 시연용이며 운영 인증 검증과 구분한다. E2E는 API 8010·웹 5180과 고유 DB/파일 폴더를 사용하므로 일반 시연 8000·5173을 종료할 필요가 없다.
