# 조직·권한 프로토타입 실행과 시연

2026-11-12. 첫 수직 구현은 로컬 가상 데이터의 로그인·소속·역할·감사다. 자료실·예산·인수인계·AI·AWS는 미구현이며 [상세 설계](design/PROTOTYPE_DESIGN.md)와 기존 F/M/T 요구를 후속 구현 기준으로 사용한다.

## 준비와 실행

저장소 루트의 Windows PowerShell에서:

```powershell
python -m venv apps/api/.venv
.\apps\api\.venv\Scripts\python.exe -m pip install -r apps/api/requirements-lock.txt
npm.cmd ci --prefix apps/web
```

터미널 1:

```powershell
.\apps\api\.venv\Scripts\python.exe -m uvicorn yeonieum.main:create_app --factory --app-dir apps/api/src --host 127.0.0.1 --port 8000
```

터미널 2:

```powershell
npm.cmd run dev --prefix apps/web
```

[로컬 화면](http://127.0.0.1:5173), [API 문서](http://127.0.0.1:8000/docs). macOS/Linux에서는 Python 경로를 `apps/api/.venv/bin/python`으로 바꾸고 `npm`을 사용한다. Node 24 및 Python 3.11에서 검증한다. 패키지는 앱별 잠금 파일로 고정한다.

최초 실행은 `local-data/prototype.sqlite3`에 가상 단체·학과·학년·반·계정·역할을 만든다. 재시작은 기존 기록을 보존하며 자동 초기화하지 않는다. 별도 가상 DB가 필요하면 실행 전 `YEONIEUM_DB_PATH`로 새 경로를 지정한다. 실제 학교 개인정보·자료를 입력하지 않는다. 기본 SQLite 파일과 브라우저 검사 산출물은 Git 제외다.

## 가상 계정

모든 시드 계정의 시연 비밀번호는 `Yeonieum-demo-2026!`다. 새로 등록한 계정은 로그인 화면의 ‘등록한 계정 직접 입력’을 사용한다.

| 가상 식별자 | 역할 |
|---|---|
| staff-demo | 담당 선생님 |
| student-chair | 의장 + 스마트소프트웨어학과 학회장 |
| student-head | 기계공학과 학회장 |
| student-vice | 부학회장, 재위임 불가 |
| student-rep | 스마트소프트웨어학과 1학년 A반 대표 |
| student-new | 역할 미부여 담당자 |
| student-other | 총학생회 학생회장 |

학과명·학과 조직 구성은 시연용이며 전체 실제 학교 조직도를 입력한 것이 아니다. 공식 임기는 시드 생성 연도 1월 1일 UTC부터 다음 해 1월 1일 UTC 미만이다. 실제 운영 임기와 학년도 경계는 DM-O05 미정이다. 화면의 날짜 입력은 한국 시간 00시로 해석하며 의장은 전제 학회장 기간을 그대로 사용한다.

## 시연 순서

1. 선생님으로 로그인해 담당자 등록을 연다. 가상 이름·이메일·학번·전화번호·소속·비밀번호를 입력한다. 등록만으로 업무 역할이 생기지 않는다.
2. 역할 부여에서 학회장을 선택한다. 기존 학회장 임기와 겹치지 않는 차기 임기로 등록하면 시작 전 권한이 활성화되지 않는다. 현재 직책 교체 시에는 선생님이 기존 역할을 사유와 함께 회수한 뒤 새 역할을 부여한다.
3. 의장 계정으로 협의회 전체와 자기 학과의 두 범위를 확인한다. 자기 학과 2학년 A반의 신규 담당자에게 반대표를 부여한다.
4. 학회장 계정은 자기 학과만 조회·지정한다. 부학회장·반대표 계정은 추가 역할 부여와 감사 조회를 할 수 없고 일반 담당자의 전체 연락처를 조회할 수 없다.
5. 선생님이 의장의 전제 학회장 자격을 회수한다. 기존 의장 세션으로 다음 요청을 하면 의장 권한도 종료된다. 자료·계정·감사 기록은 삭제하지 않는다.
6. 선생님은 전체, 최고 책임자는 자기 단체의 활동 이력을 확인한다. 변경 사유와 역할 부여·회수·전제 자격 종료가 각각 남는다.

의장 선출은 실제 학회장들의 투표 사실을 선생님이 확인 메모로 기록하는 방식이다. 온라인 투표나 선생님의 단독 선출 기능을 구현한 것이 아니다. 중도 선출·대행에 대한 실제 학교 규칙은 별도 확인한다.

## 검사

```powershell
.\apps\api\.venv\Scripts\python.exe -m ruff check apps/api
.\apps\api\.venv\Scripts\python.exe -m ruff format --check apps/api
.\apps\api\.venv\Scripts\python.exe -m pytest apps/api -q
npm.cmd run format:check --prefix apps/web
npm.cmd run build --prefix apps/web
npm.cmd run test:e2e --prefix apps/web
```

브라우저 테스트는 기존 데모 DB와 별개의 고유 SQLite 파일을 만들고 테스트용 서버를 시작·종료한다. 로컬 Chrome, CI에서는 Playwright Chromium을 사용한다. 테스트 전에 8000·5173 포트의 일반 시연 서버를 종료한다. Linux CI는 `npx playwright install --with-deps chromium`을 실행한다.

13개 API 테스트는 T-01~03·17~19 중 구현 범위만 확인한다. T-04~16 전체 통과, Cognito·PostgreSQL·AWS 검증 또는 학교 운영 승인으로 표현하지 않는다. 실제 테스트 결과와 커밋은 후속 변경 시 다시 확인한다.
