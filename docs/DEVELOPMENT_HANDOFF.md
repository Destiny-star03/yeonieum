# 연이음 개발 인계 — 2026-11-22

2026-11-23 후속 점검: 운영 v1의 배포 대상은 별도 서버 PC와 공개 도메인이다. 전체 로컬 검사와 격리 백업·복원 결과, 운영 앱·호스트 확인 상태는 [서버컴 배포 점검](SERVER_DEPLOYMENT.md)을 따른다.

다음 모델이 같은 저장소에서 개발을 이어가기 위한 기록이다. 새로운 개발 항목은 아직 지정되지 않았다. 아래 상태는 다시 확인하고, 사용자 지시 없이 기능 추가·커밋·푸시·PR 병합·배포를 시작하지 않는다.

## 작업 위치와 Git

- 경로: `D:\Tak\yeonieum`, Windows PowerShell. 다른 위치에 복사하거나 새 프로젝트를 만들지 않는다.
- 저장소: https://github.com/Destiny-star03/yeonieum
- 작업 브랜치: `feature/access-prototype`, PR 대상: `develop`.
- 기존 [PR #4](https://github.com/Destiny-star03/yeonieum/pull/4)를 이어 쓴다. main/develop 직접 커밋·푸시, 강제 푸시·임의 stash/reset을 하지 않는다.
- 앞선 누적 기능은 `9b647ad`까지 푸시했고 [해당 PR CI 4개](https://github.com/Destiny-star03/yeonieum/actions/runs/44913157179)가 통과했다. 최근 시간 UX 기능 커밋은 `7b7f3d6` (`feat(calendar): preserve duration and collapse time settings`)이며 인계 문서 커밋을 뒤에 추가한다. 최신 HEAD를 과거 값으로 가정하지 않는다.
- 2026-11-22 사용자는 현재까지의 커밋·푸시를 승인했다. 이후 추가 수정의 자동 푸시·병합·배포 승인으로 일반화하지 않는다.

첫 확인:

```powershell
cd D:\Tak\yeonieum
git status --short --branch
git branch --show-current
git rev-parse HEAD
git remote -v
git log -6 --oneline
git fetch --prune origin
git rev-list --left-right --count HEAD...origin/feature/access-prototype
gh pr view 4 --json headRefOid,baseRefName,state,url
gh pr checks 4
```

`AGENTS.md`, `C:/Users/cyt11/.agents/skills/git-collaboration/SKILL.md`, `.agents/skills/yeonieum-git-workflow/SKILL.md`, `docs/GIT_WORKFLOW.md`를 먼저 따른다. 핵심 문서는 DEVELOPMENT_BRIEF.md·ACCEPTANCE.md·ACCESS_CONTROL.md·FUNCTIONAL_SPEC.md·DOMAIN_MODEL.md·PROTOTYPE.md·PROTOTYPE_COMPLETION.md와 루트 GLOSSARY.md다. 구조 변경 전 PROJECT_STRUCTURE.md·CONTRIBUTING.md와 project-structure 스킬을 읽는다. 문서의 C/R/P/O와 기능 우선순위를 구분한다.

## 현재 구현과 최근 변경

React·TypeScript·Vite 웹은 `apps/web`, FastAPI·SQLite API는 `apps/api`, 브라우저 검사는 `tests/e2e`, AWS 영역은 `infra`다. 앱별 잠금 파일과 학교 이미지·Pretendard·리넨 팔레트를 유지한다.

- 조직·권한: 담당자 등록/복구·로컬 초대 인증, 조직/역할 종류/하위 조직 삭제·복원, 학회장 위임과 의장 겸임·동일 임기·전제 역할 종료를 구현했다. 계정·감사·과거 기록을 보존하고 복원으로 과거 권한을 되살리지 않는다.
- 자료실: 연도 → 단체 → 개인 보관/단체 공유 → 폴더/파일, 드래그 업로드·간결한 등록창·검색/필터·버전·휴지통/복원을 제공한다. 타인의 개인 자료는 선생님/책임자도 열람하지 못한다. `design/DOCUMENT_LIBRARY.md`의 최신 절이 과거 미구현 설명보다 우선한다.
- 예산·인수인계: 단체 연간/행사 예산·실제 지출·증빙·검토·초과분·전체 정산, 필수 인계 항목·참조 자료·인수자 확인을 제공한다. Excel/CSV 미리 읽기는 확인한 합계의 지출 1건 입력이며 OCR·행별 일괄 장부 생성이 아니다. 실제 지출은 미검토/반려 상태여도 집계에 남는다. `design/LOCAL_FINANCE_HANDOVER.md`의 P 권한·보존·정산 경계를 따른다.
- 캘린더: 월/주/일, 반복·참여자·링크·자료 참조·포털 리마인더·드래그·검색·복사·색상 점 팝업을 제공한다. 일정 막대 밖을 누르면 폐기 확인·저장 중 보호를 유지하며 기본 패널로 돌아간다. `design/CALENDAR.md`를 따른다.
- 최근 시간 연동(CAL-T11): 새 시간 일정은 기본 30분이다. 종료 시간을 직접 정한 뒤 시작 시간을 옮기면 길이를 유지한다. `00:00~01:15 → 12:00~13:15`, 자정을 넘으면 종료 날짜도 이동한다. 불완전한 직접 입력 중 마지막 유효 길이를 보존한다. 종료 오른쪽에 보조색으로 ‘30분’·‘1시간 15분’을 표시한다. 기존 저장 일정·드래그/복사의 명시적 기간은 열기만으로 변경하지 않는다.
- 최근 설정 요약(CAL-T12): 날짜 아래 ‘종일 · 시간대 · 반복’ 줄을 처음 표시하고 hover/키보드 초점에서 배경을 강조한다. 클릭/Enter/Space로 펼치고 오른쪽 접기 버튼으로 줄이며 값은 유지한다. 새 편집 진입은 접힌 상태다. 읽기 전용 일정은 펼쳐 확인할 수 있지만 설정은 비활성이다. 펼치기/접기 자체는 수정 상태나 저장 요청을 만들지 않는다.

최근 수정의 중심은 `apps/web/src/features/calendar/EventDialog.tsx`(기간 유지·날짜 이동·설정 접기), `RepeatPicker.tsx`(접힌 설정 안의 기본 반복 표시), `calendar.css`(요약/hover/펼침), `tests/e2e/calendar.spec.ts`(CAL-T11/12와 기존 흐름)다. 서버 API·기존 DB 스키마는 이번 시간 UX에서 바꾸지 않았다.

## 공식 일정과 미완료 범위

학교 [학사일정](https://eng.yc.ac.kr/www/scheduleList.do)은 실제로 52개를 수집한 이력이 있다. 공개 출처별 읽기 전용 캐시는 사용자 일정과 분리하고, API 실행 중 성공 원본은 24시간 후 갱신하며 실패 시 마지막 정상 자료를 유지한다. 서버 종료 중 갱신은 없다.

공휴일은 [한국천문연구원 공식 API](https://www.data.go.kr/data/15012690/openapi.do)의 인증키 설정 대기 상태다. `YEONIEUM_HOLIDAY_SERVICE_KEY`를 API 프로세스 환경에 설정해야 하며 키는 채팅·Git·웹 저장소에 넣지 않는다. 실제 공휴일 API 호출 성공은 아직 검증하지 않았다. `design/EXTERNAL_CALENDARS.md`의 설정 안내를 따른다. 학교 목록이나 비공식 휴일로 대체하지 않는다.

자료/회계 운영 정책의 미결정 사항, 실제 학교 인증·외부 메일·외부 알림·AI·AWS·운영 배포·확정 정산 후 정정·외부 캘린더 양방향 동기화·반복 단일 회차 편집은 후속이다. 설계 문서나 로컬 시연을 운영 완료로 표현하지 않는다.

## 실행과 데이터 보존

기존 `local-data/prototype.sqlite3`, `local-data/prototype-files`, `local-data/prototype-evidence`를 함께 보존한다. 2026-11-22 확인에서는 DB·일반 파일 폴더가 존재하고 기본 증빙 폴더는 없었다. 임의 초기화·시드 복원·자동 데이터 변환을 하지 않는다. DB·초대 링크·개인정보·업로드 파일·스크린샷·인증키는 Git에서 제외한다. 기본 시연 계정 일부는 비활성일 수 있으며 새 계정 비밀번호를 시드 비밀번호와 혼동하지 않는다.

API와 웹을 별도 PowerShell 창에서 실행한다. 기존 가상환경/의존성이 있으면 다시 설치하지 않는다.

```powershell
cd D:\Tak\yeonieum
.\apps\api\.venv\Scripts\python.exe -m uvicorn yeonieum.main:create_app --factory --app-dir apps/api/src --host 127.0.0.1 --port 8000
```

```powershell
cd D:\Tak\yeonieum
npm.cmd run dev --prefix apps/web
```

웹은 http://127.0.0.1:5173/, API 문서는 http://127.0.0.1:8000/docs 다. 종료는 각 창에서 Ctrl+C다. 실행 여부는 실제 포트를 확인하며 문서만으로 켜져 있다고 가정하지 않는다.

## 검증과 다음 작업

앞선 `9b647ad`의 로컬 API는 186개, 브라우저는 34개가 통과했다. 2026-11-22에는 시간 UX를 포함한 전체 브라우저 **36개**·Git 정책 **12개**·웹 빌드·포맷·전체 파일 공통 검사가 통과했다. 환경은 Node 24.22.1·Python 3.11.9다. 최신 원격 검사 결과는 이번 푸시의 PR Checks를 확인한다. API 코드가 그대로인 이번 UX 변경에서는 이전 API 수치를 새 로컬 재실행 결과로 표현하지 않는다.

```powershell
npm.cmd run format:check --prefix apps/web
npm.cmd run build --prefix apps/web
npm.cmd run test:e2e --prefix apps/web
.\apps\api\.venv\Scripts\python.exe -m ruff check apps/api
.\apps\api\.venv\Scripts\python.exe -m ruff format --check apps/api
.\apps\api\.venv\Scripts\python.exe -m pytest apps/api -q
.\.venv\Scripts\python.exe -m pre_commit run --all-files --show-diff-on-failure
.\.venv\Scripts\python.exe -m unittest discover -s tests/unit -p 'test_*.py' -v
```

E2E는 고유 DB/파일과 API 8010·웹 5180을 사용하고 `YEONIEUM_EXTERNAL_SYNC=0`으로 외부 수집을 끈다. 일반 8000/5173 서버를 종료할 필요가 없다. Windows에서 모든 테스트 결과가 나온 뒤 종료가 지연되면 테스트 리스너 PID와 프로젝트 실행 경로를 확인해 그 프로세스만 종료한다. 다른 Python/Node 프로세스를 일괄 종료하지 않는다. 커밋 훅은 미스테이징 변경을 일시 격리할 수 있으므로 앱/설정 변경이 남은 상태의 커밋과 브라우저 검사를 동시에 실행하지 않는다.

다음 모델은 먼저 상태와 최신 CI를 확인한 뒤 사용자에게 지정받은 작업을 이어간다. 공휴일 인증키 발급·설정과 실제 호출 검증은 남아 있으나 별도 키 없이 성공을 주장하거나 임의 클라우드 자원을 만들지 않는다.
