# 연이음 API 앱

업무 규칙과 서버 측 접근 제어의 시작 디렉터리다. 현재 실행 가능한 API는 없다. Python·FastAPI는 기존 권장안이며 설치하지 않았다.

- `src/yeonieum/modules`: 실제 구현하는 기능의 HTTP 라우터·서비스·입출력·필요한 저장 모델.
- `src/yeonieum/core`: 설정·로그·DB 연결 같은 기반 코드. 업무 규칙은 해당 모듈에 둔다.
- `tests`: 기능별 단위·통합 테스트. 권한·기간·범위·금액·자료 보존을 수용 기준과 연결한다.

첫 API를 구현할 때 이 앱의 의존성 명세·lockfile·설정·마이그레이션·린트·포맷·테스트를 선택하고 검증한 명령을 여기에 기록한다. API를 선택한 프레임워크의 OpenAPI와 연결한다.

[기여 가이드](../../CONTRIBUTING.md)와 [구조 안내](../../docs/PROJECT_STRUCTURE.md)를 따른다.
