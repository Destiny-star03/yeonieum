# 연이음 개발 가이드

코드를 추가하기 전에 [구조 안내](docs/PROJECT_STRUCTURE.md), [프로젝트 지침](AGENTS.md), [기능명세](docs/FUNCTIONAL_SPEC.md)를 읽는다. 이 문서는 파일 배치와 협업 규칙을 정한다. 앱의 기술 스택·의존성은 아직 최종 선택 전이다.

## Git 작업 규칙

[Git 협업·배포 규칙](docs/GIT_WORKFLOW.md)을 따른다. 최신 develop에서 `feature/*` 또는 `bugfix/*`를 만들고 작은 Conventional Commit→push→PR→develop 검토·병합으로 진행한다. main은 검증된 develop·release·hotfix PR을 운영 책임자가 병합한다. GitHub Actions와 실제 서버 배포를 구분한다.

## 처음 시작하기

현재는 문서와 시작 디렉터리, 공통 검사 설정만 있다. 웹·API 실행, 앱 빌드·테스트 명령은 실제 코드와 도구가 추가될 때 각 앱 README에 검증 후 기록한다.

Git 저장소를 clone한 뒤 공통 검사 환경을 만든다. Windows PowerShell 예시:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pre_commit install
.\.venv\Scripts\python.exe -m pre_commit run --all-files --show-diff-on-failure
```

macOS/Linux에서는 `.venv/bin/python`으로 같은 명령을 실행한다. 훅 설치는 Git 저장소 안에서 수행하고 pre-commit·commit-msg가 함께 설치된다. 변경 후 `python -m unittest discover -s tests/unit -p "test_*.py" -v`로 Git 정책의 동작도 검사한다. 현재 폴더에 Git 메타데이터나 원격 연결을 임의로 만들지 않는다. 첫 실행에는 검사 도구 다운로드가 필요하다.

## 기능을 추가할 때

1. 해당 기능의 M/F/AUTH 요구 ID와 수용 기준을 확인한다. 문서와 최신 사용자 결정이 다르면 최신 결정을 확인해 반영한다.
2. 기존 기능 폴더를 먼저 찾는다. 새로운 기능이 실제로 구현될 때 폴더를 만들고 관련 UI·API·업무 로직·테스트를 가까이 둔다.
3. 기능 사이에는 작은 서비스 인터페이스나 명시적인 입출력을 사용한다. 다른 기능의 내부 저장 로직을 직접 수정하지 않는다.
4. 입력·금액·권한·상태 전이·자료 보존 등 변경 위험에 맞는 검증을 실행한다. 낮은 영향의 단순 문서·표시 수정에 불필요한 테스트를 늘리지 않는다.
5. 실행·환경 설정·API·배포 방법이 바뀌면 관련 README/문서를 같은 변경에서 갱신한다.

## 이름과 서식

| 대상 | 규칙 |
|---|---|
| 일반 디렉터리 | 영어 kebab-case. Python 패키지는 snake_case |
| React 컴포넌트 파일·클래스 | PascalCase |
| TypeScript 일반 파일 | kebab-case. 훅 파일은 프로젝트에서 정한 useXxx 규칙 |
| TypeScript 함수·변수 | camelCase |
| Python 파일·함수·변수 | snake_case |
| 상수 | UPPER_SNAKE_CASE |
| 문서 | 기존 대문자 Markdown 이름 유지 |

이름은 역할과 단위를 드러낸다. 예를 들어 `calc(x, y)` 대신 `calculate_remaining_budget(allocated_amount, confirmed_expenses)`처럼 목적을 표현한다. 돈의 단위·승인 상태를 함수와 타입에서 명확히 하고, 할인율처럼 비율 단위가 필요한 계산은 호출 규약에 기록한다.

`.editorconfig`와 `.gitattributes`로 UTF-8·LF·들여쓰기를 맞춘다. Markdown의 의미 있는 줄바꿈 공백은 공통 훅이 보존한다.

## 자동 검사와 리뷰

현재 공통 훅은 YAML/JSON/TOML 구문, 충돌 표시, 파일명 대소문자 충돌, 비밀키, 5 MiB 초과 Git 파일, 줄 끝·파일 끝 서식을 검사한다. 포털 업로드 제한과 Git 파일 크기 검사는 별개다.

웹 코드와 도구를 도입할 때 ESLint/Prettier·타입 검사·기능 테스트를, Python 코드를 도입할 때 Ruff 등 선택한 린터/포매터·테스트를 해당 앱 설정에 추가한다. 기존 공통 검사와 함께 CI에서 실행하도록 연결한다. 지금은 해당 도구가 설치되거나 앱 코드가 검증되었다고 표시하지 않는다.

PR에는 해결할 문제, 변경된 동작·영향, 실행한 검사, 미실행 검증을 적는다. 요구 ID가 있으면 연결한다. 큰 변경은 독립적으로 검토 가능한 단위로 나누고, 인증·범위·회계·파일 버전·인수인계의 영향은 구현 근거로 설명한다. 형식 문제는 자동 검사에 맡기고 리뷰에서는 동작과 경계를 확인한다.

실제 영수증·학생 개인정보·환경 비밀은 Git에 넣지 않는다. `.env.example`에는 변수 이름과 비밀이 아닌 예시만 기록한다. 의존성 명세·lockfile·가상 테스트 자료·문서는 포함한다.
