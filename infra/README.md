# 연이음 인프라

운영 v1은 Windows 서버 PC의 Docker, PostgreSQL과 공개 도메인을 사용한다. `server-pc/compose.yaml`은 호스트 내부의 웹·API·PostgreSQL 확인에 사용하고, `server-pc/compose.public.yaml`은 공개 Caddy와 선택 사항인 Duck DNS 갱신기를 실행한다. [서버컴 배포 점검](../docs/SERVER_DEPLOYMENT.md)

호스트·운영체제·접속 경로가 확인되면 환경별 공개 설정과 비밀 주입 경로를 구분한다. 생성·변경·검증·복구 절차를 구현과 함께 문서화하고 비밀 키와 서버 데이터는 전용 저장소에서 관리한다.

공통 CI는 파일 품질 검사이며 배포 권한을 갖지 않는다. 웹과 API별 배포 경계를 [구조 안내](../docs/PROJECT_STRUCTURE.md)와 함께 유지한다.

`github/`에는 GitHub 브랜치 보호의 선언형 설정을 둔다. 실제 적용 상태는 API로 확인한다. [Git 협업 규칙](../docs/GIT_WORKFLOW.md)에 권한·검사·배포 경계를 기록한다.
