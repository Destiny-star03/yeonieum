# 연이음 API

FastAPI와 SQLite를 사용하는 가상 데이터 전용 조직·권한 로컬 프로토타입이다. 인증·역할 HTTP 처리는 `src/yeonieum/modules/access`, 가상 시드는 `modules/organizations`, DB·감사는 `core`에 둔다. 요청마다 현재 역할·범위·기간을 검사하고 변경과 감사를 한 트랜잭션으로 저장한다.

앱 전용 Python 3.11 환경과 고정 의존성은 `requirements-lock.txt`, 검사 설정은 `pyproject.toml`이다. 실제 실행·시연·검사는 [프로토타입 가이드](../../docs/PROTOTYPE.md)를 따른다. 실행은 저장소 루트에서 해야 하며 `local-data`와 앱 가상환경은 Git에 포함하지 않는다.

운영 인증·개인정보 보존·계정 복구·자료·회계·인수인계·AWS 연결은 미구현이다. SQLite는 이 프로토타입의 임시 로컬 저장 선택이며 운영 PostgreSQL 전환 전 마이그레이션·동시성·복구를 별도 검증한다.
