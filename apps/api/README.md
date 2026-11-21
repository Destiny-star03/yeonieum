# 연이음 API

공식 일정은 `modules/calendar/external_calendar.py`의 고정 HTTPS 수집·캐시와 `external_parsers.py`의 학교 HTML/공휴일 XML 검증으로 분리한다. `GET /api/calendar/external?start=...&end=...`은 현재 역할이 있는 로그인 사용자의 공개 일정 조회, `POST /api/calendar/external/refresh`는 같은 기간 매개변수를 받는 선생님 전용 갱신이다. 기존 일정 API의 인가는 유지한다. `YEONIEUM_HOLIDAY_SERVICE_KEY`에 공공데이터포털 인증키를 설정하면 공식 공휴일 수집을 시작한다. `YEONIEUM_EXTERNAL_SYNC=0`은 테스트의 외부 통신을 끈다. 인증키·원문 오류는 저장/노출하지 않는다. 실행 중 자동 갱신과 설정은 [공식 일정 계약](../../docs/design/EXTERNAL_CALENDARS.md)을 따른다.

2026-11-21 예산 보완: `GET /api/budgets/overview?year=2026`은 현재 회계 열람 범위의 단체별 현황을 반환한다. `POST /api/budgets/annual`의 선생님 편성 권한과 엄격한 불리언 `authorize_heads` 선택을 지원한다. `POST /api/budgets/import-preview?org_id=...&year=...&filename=...`는 원시 XLSX/UTF-8 CSV 본문을 5 MiB까지 받아 제한된 용도·금액 표를 미리 읽고 저장하지 않는다. 파싱은 `modules/budgets/spending_preview.py`, 권한·확정 경계와 원본 증빙 저장은 기존 budgets 라우터가 담당한다. [계약과 제한](../../docs/design/LOCAL_FINANCE_HANDOVER.md)을 따른다.

2026-11-20 자료실의 `modules/documents/folders.py`에 실제 중첩 폴더를 추가했다. 개인/단체 공유는 현재 서버 권한으로 구분하며 기존 DB에는 폴더 테이블과 nullable folder_id를 추가한다. 파일/버전/기존 공유 범위는 자동 변경하지 않는다. 자세한 API와 임시 운영 정책은 [자료실 계약](../../docs/design/DOCUMENT_LIBRARY.md)의 최신 절을 따른다.

FastAPI와 SQLite를 사용하는 가상 데이터 전용 로컬 프로토타입이다. 인증·역할 HTTP 처리는 `src/yeonieum/modules/access`, 가상 시드는 `modules/organizations`, DB·감사는 `core`에 둔다. 요청마다 현재 역할·범위·기간을 검사하고 변경과 감사를 한 트랜잭션으로 저장한다.

앱 전용 Python 3.11 환경과 고정 의존성은 `requirements-lock.txt`, 검사 설정은 `pyproject.toml`이다. 실제 실행·시연·검사는 [프로토타입 가이드](../../docs/PROTOTYPE.md)를 따른다. 실행은 저장소 루트에서 해야 하며 `local-data`와 앱 가상환경은 Git에 포함하지 않는다.

`modules/calendar`는 현재 범위의 일정·반복 회차·참여자·자료 참조·시간만 공개·포털 리마인더를 맡는다. 관련 세부는 [캘린더 계약](../../docs/design/CALENDAR.md)에 기록하며 외부 동기화·이메일 알림은 제공하지 않는다.

`modules/documents`에 일반 자료 업로드·검색·분류·버전·인증 다운로드·휴지통·복원을 추가했다. 계정 복구는 동일 학번+이메일의 로컬 초대 방식이다. 자료 권한·형식·저장·DB+파일 수동 백업/복원은 [자료실 구현 계약](../../docs/design/DOCUMENT_LIBRARY.md)을 따른다. 기본 파일 폴더는 `local-data/prototype-files`이며 DB와 함께 보존해야 한다.

`modules/budgets`는 단체별 연간·행사 예산, 실제 지출·검토·민감 증빙·정산을, `modules/handovers`는 인계 항목·인수자 확인을 맡는다. 민감 증빙 파일은 DB와 함께 `local-data/prototype-evidence`에 보존한다. [로컬 구현 계약](../../docs/design/LOCAL_FINANCE_HANDOVER.md)을 따른다. 운영 인증·개인정보 보존 정책·확정 후 정정·AWS 연결은 후속이다. SQLite는 임시 로컬 저장 선택이며 운영 PostgreSQL 전환 전 마이그레이션·동시성·복구를 별도 검증한다.
