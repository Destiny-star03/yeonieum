# 연이음 v1 서버컴 배포 점검

운영 v1은 Windows 서버 PC에서 Docker로 실행하고 PostgreSQL을 사용한다(C). 첫 미리보기는 현재 Windows 11 Home PC를 사용한다. 공개 주소는 Duck DNS 서브도메인을 사용하고 HTTPS는 Caddy가 처리한다. 관리 접속 설정, 등록한 주소, 학교 계정 확인과 실제 자료 반입 정책은 확인 중이다. 기존 AWS 설계와 수용 테스트는 과제 참고 자료로 보존한다.

## Windows 서버 관리 접속

P. 배포·로그 확인에는 Windows OpenSSH와 키 인증을 사용한다. 같은 공유기 안에서만 관리할 때는 서버의 내부 IP로 접속한다. 외부에서도 관리할 때는 서버와 관리 PC를 Tailscale에 연결하고 서버의 Tailscale 주소로 OpenSSH에 접속한다. 공유기에서 인터넷에 전달하는 포트는 Caddy의 TCP 80·443이다. [Windows OpenSSH](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse) · [Tailscale을 통한 OpenSSH 접속](https://tailscale.com/docs/reference/ssh-over-tailscale)

서버에서 OpenSSH Server를 설치하고 `sshd`를 자동 시작으로 설정한다. 관리용 공개 키를 등록하고 서버 콘솔에서 호스트 키를 대조한 뒤 관리 PC에서 키 로그인과 `docker version`을 확인한다. 외부에서 관리한다면 Tailscale 무인 모드를 켜고 재부팅 후 Windows 로그인 전에도 SSH로 접속할 수 있는지 확인한다. [Windows 무인 모드](https://tailscale.com/docs/how-to/run-unattended)

화면 조작이 필요한 경우 지원되는 Windows 버전에서 같은 내부망 또는 Tailscale을 통해 원격 데스크톱을 사용한다. Windows Home에서는 내장 원격 데스크톱 호스트 기능을 사용할 수 없다. [Windows 원격 데스크톱](https://learn.microsoft.com/en-us/windows-server/remote/remote-desktop-services/remotepc/remote-desktop-allow-access)

## Docker 구성

서버에서 Linux 컨테이너를 실행할 수 있는 Docker Engine 28 이상과 Docker Compose를 사용한다. 아래 명령은 저장소의 `infra/server-pc`에서 실행한다. [Docker 포트 공개 방식](https://docs.docker.com/engine/network/port-publishing/)

Windows 10/11의 지원되는 버전에서는 Docker Desktop의 WSL 2 백엔드로 미리보기를 시험할 수 있다. Docker Desktop의 로그인 시 시작 설정과 서버 재부팅 후 Docker의 실제 기동 시점을 확인한다. Windows Server 제품에는 Docker Desktop을 사용할 수 없으므로 대상 버전을 확인한 뒤 Linux 컨테이너 실행 환경을 정한다. [Windows 설치 요구사항](https://docs.docker.com/desktop/setup/install/windows-install/) · [Docker Desktop 시작 설정](https://docs.docker.com/desktop/settings-and-maintenance/settings/)

| 파일 | 실행 대상 | 접속 경로 |
|---|---|---|
| `compose.yaml` | PostgreSQL, FastAPI, 웹 빌드, Caddy 미리보기 | 서버 내부 `http://127.0.0.1:8173` |
| `compose.public.yaml` | 공개 Caddy, 선택 사항인 Duck DNS IPv4 갱신기 | `https://등록한이름.duckdns.org/healthz` |

## Duck DNS와 Caddy 접속 확인

1. Duck DNS에서 사용할 이름을 등록하고 서버 네트워크의 공인 IPv4를 가리키게 한다. `.env.example`을 같은 디렉터리의 `.env`로 복사한 뒤 `YEONIEUM_PUBLIC_HOST`에 실제 등록한 `이름.duckdns.org`를 입력한다. [Duck DNS 등록](https://www.duckdns.org/)
2. 공유기 뒤에 서버가 있으면 TCP 80·443을 서버 PC로 전달하고 호스트 방화벽에서 허용한다. 서버가 직접 공인 IP를 사용하는 환경은 방화벽에서 연결을 허용한다. 외부 접속이 제한된 네트워크라면 호스트에서 공인 DNS를 확인한 뒤 관리자에게 인터넷 진입 경로를 확인한다. [Caddy 자동 HTTPS 조건](https://caddyserver.com/docs/automatic-https)
3. 공개 Caddy를 시작한다.

   ```text
   docker compose -f compose.public.yaml config --quiet
   docker compose -f compose.public.yaml up -d
   ```

4. 공인 IPv4가 바뀌는 환경에서는 갱신 토큰만 담은 `.env.duckdns-token` 파일을 같은 디렉터리에 만들고 서버 관리자만 읽도록 설정한다. `docker compose -f compose.public.yaml --profile ddns up -d`로 갱신기를 함께 실행한다. 갱신기는 5분마다 HTTPS로 서버 네트워크의 현재 IPv4를 반영한다. [Duck DNS 갱신 규격](https://www.duckdns.org/spec.jsp)
5. 다른 네트워크에서 `https://이름.duckdns.org/healthz` 응답이 `200 ok`이고 HTTPS 인증서가 유효한지 확인한다. HTTP의 HTTPS 전환도 확인한다. 공개 Caddy의 다른 경로는 준비 중 응답(503)을 반환한다. 인증서는 Caddy의 영구 볼륨에 저장된다. 서버 재부팅 후 Docker와 컨테이너가 다시 시작되는지 확인한다.

## 별도 서버에서 앱 미리보기

`infra/server-pc`에 PostgreSQL 관리자와 앱 사용자용 서로 다른 비밀번호를 각각 `.env.postgres-admin-password`, `.env.postgres-app-password` 파일에 한 줄로 저장한다. 첫 기동 시 초기화 스크립트가 앱 전용 계정을 만들고 앱이 스키마를 생성한다. 데이터베이스 포트는 Docker 네트워크 안에서만 사용한다.

```text
docker compose config --quiet
docker compose up -d --build --wait
```

서버에서 `http://127.0.0.1:8173`을 열고 화면과 `/api/health`의 `database: postgresql`을 확인한다. SSH를 사용한다면 관리 PC에서 `ssh -L 8173:127.0.0.1:8173 사용자@서버`로 터널을 연 뒤 같은 주소로 접속한다. API 포트는 호스트에 공개하지 않는다.

미리보기는 새 PostgreSQL DB와 가상 계정으로 시작한다. DB는 `postgres_data`, 자료실 파일과 증빙은 `preview_data` 볼륨의 `files/`와 `evidence/`에 저장한다. 기존 SQLite 기록의 이전 여부와 범위는 별도로 결정한다. 백업은 별도 장비에도 보관한다. [Docker 볼륨 보존](https://docs.docker.com/engine/storage/volumes/)

Windows에서 직접 실행할 때는 API에 `YEONIEUM_DATABASE_URL`, `YEONIEUM_STORAGE_ROOT`를 지정한다. 비밀번호를 별도로 주입할 때는 `YEONIEUM_POSTGRES_PASSWORD_FILE`도 지정한다. PostgreSQL을 지정하지 않은 로컬 개발 모드는 기존 SQLite 경로를 사용한다.

일반 미리보기는 학교 학사일정을 기본으로 자동 갱신한다. 외부 요청을 생략하는 자동 검사와 오프라인 점검은 `YEONIEUM_EXTERNAL_SYNC=0`을 사용한다. 공휴일 연동에는 별도 인증키가 필요하다. [공식 일정 연동 설정](design/EXTERNAL_CALENDARS.md)

API 이미지는 Linux용 `hwp-cli 1.3.1` 체크섬을 검증하고 한글 글꼴을 설치한다. 대상 서버에서 가상 자료로 200 MiB 업로드와 HWP/HWPX의 여러 페이지 미리보기를 확인한다. [한글 변환기 릴리스](https://github.com/STAIxBWLB/agent-hwp/releases/tag/v1.3.1)

## 점검 기록

| 항목 | 상태 | 확인 결과와 남은 검증 |
|---|---|---|
| 배포 대상과 접속 범위 | 확정 | 별도 서버 PC, 공개 도메인. |
| 브랜치 보호와 원격 검사 | 확인 | GitHub API에서 `main`·`develop`의 PR 및 필수 검사 규칙을 확인했다. PR #4의 원격 HEAD `1924f79`는 필수 CI 4개가 성공했고 PR 대상은 `develop`이다. `production` 환경은 아직 없다. 현재 작업 트리의 변경을 포함한 출시 후보를 확정한 후 해당 커밋의 CI를 다시 확인한다. |
| 웹 빌드와 웹/API 연결 | 로컬 확인 | Caddy 2.11.9로 빌드된 정적 JS, 동일 출처 `/api/health`, 없는 API 경로의 404를 루프백에서 확인했다. 로컬 인증서를 사용해 공개용 설정의 HTTPS 전환과 `/healthz` 응답도 검증했다. 실제 서버의 DNS·인증서는 확인 대기다. |
| Docker 구성과 Duck DNS 갱신 | 구성 확인 | Compose가 해석한 포트·볼륨·별도 네트워크를 확인했다. 모의 응답으로 갱신 성공·거절·통신 실패를 검증했다. 컨테이너 빌드·기동과 실제 DNS 갱신은 서버에서 확인한다. |
| 기능 검사 | 로컬 통과 | 2026-11-23 현재 작업 트리에서 API 195개, 전체 브라우저 43개, Git 정책 12개, Ruff·Prettier·TypeScript·웹 빌드와 공통 검사가 통과했다. PDF 테스트는 사전 역할이 없는 별도 가상 계정으로 준비해 다른 권한 테스트의 계정 변경과 분리했다. |
| DB와 파일 복원 | 로컬 확인 | 격리된 가상 DB와 가상 자료를 새 위치에 백업·복원하고 서버를 재시작했다. 계정 로그인, 일반 문서 두 버전, 증빙 체크섬, 예산 사용액과 잔액을 확인했다. 다른 단체 계정의 문서·증빙 접근은 거부됐다. 서버 PC 외부 백업과 호스트 장애 복구 훈련은 남아 있다. |
| PostgreSQL 미리보기 | 현재 PC 확인 | PostgreSQL 17.12를 사용해 별도 테스트 DB와 저장소에서 앱을 기동했다. 실제 DB에서 자료실 권한·폴더 중복 방지, 캘린더 재조회와 예산 금액·집행 순서를 확인했다. 가상 DB 덤프와 자료 파일을 새 위치에 복원해 로그인과 다운로드를 확인했다. |
| 운영 앱 | 미구현 | 공개 HTTPS 연결 전 운영 실행 경로, 실제 계정 확인, 관리자 초기 등록과 HTTPS 전용 세션 쿠키가 필요하다. 현재 앱은 데모 초대 수신함을 사용한다. |
| 운영 서버와 HTTPS | 확인 대기 | 서버 식별·접속, 대상 OS와 재부팅 후 자동 재시작, 도메인 DNS와 외부 접속 경로, 인증서 발급·갱신을 실제 호스트에서 확인한다. |

## 서버 PC 구성과 검증 순서

1. 서버 소유·관리 담당자, OS·디스크 여유·관리 접속, 도메인 DNS 변경 권한을 확인한다. 서버 네트워크의 공인 주소나 인터넷 진입 경로, 방화벽·라우터·학교망 제한을 확인한다. 운영 데이터와 다른 장비에 백업을 저장할 위치를 정한다.
2. 공개 HTTPS 역방향 프록시가 정적 웹 빌드와 `/api`를 동일 도메인으로 제공하도록 준비한다. API와 DB의 서비스 포트는 공개 진입 경로에서 제외하고, DB·파일·증빙 디렉터리는 웹 루트 밖에 둔다. 실제 도메인으로 인증서, 외부 접속, 제한된 관리 접속, 재부팅 후 자동 기동을 시험한다. [Caddy HTTPS 운영 참고](https://caddyserver.com/docs/automatic-https)
3. 별도 운영 설정을 구현한다. 운영 데이터 경로·허용 호스트·HTTPS 출처를 명시하고, HTTPS 전용 세션 쿠키와 학교가 승인한 계정 확인·복구 방식을 적용한다. 운영 데이터로 시작하는 과정에서 데모 시드와 로컬 초대 수신함이 열리지 않게 하고, 배포 서비스 계정에 필요한 파일 접근만 부여한다.
4. 서버의 테스트 환경에서 실제 데이터 없는 배포를 검증한다. 다른 단체·만료 계정의 권한 거절, 200 MiB 일반 자료 업로드·재시도, 버전과 증빙 격리, PDF·한글 페이지 렌더링, 예산·정산·인수인계를 확인한다. 공식 공휴일을 출시 범위에 포함하면 실제 키를 설정하고 갱신을 확인한다.
5. API 기록 작업을 중지한 동안 PostgreSQL의 `pg_dump -Fc` 덤프와 두 파일 저장소를 한 세트로 백업한다. 테스트 DB에 `pg_restore`하고 복원한 두 저장소를 연결해 문서 버전·증빙 체크섬·정산 합계를 검산한다. 실제 복구 시간·허용 데이터 손실 시간, 백업 보존기간, 오류·디스크·백업 실패 알림과 수신자를 기록한다. [PostgreSQL 백업과 복구](https://www.postgresql.org/docs/17/backup-dump.html)
6. 학교 시범 운영과 최종 버전을 승인한 후 `feature → develop → main` PR로 통합하고, 확인된 커밋을 `v1.0.0` 배포 기준으로 지정한다. 서버에서 빌드·마이그레이션·배포·복구 절차를 재현한 뒤 처음 승인된 시범 단체의 주요 흐름을 확인한다. [연이음 Git 배포 기준](GIT_WORKFLOW.md#배포-경계)

로컬 재현 명령은 [프로토타입 검사](PROTOTYPE.md#검사)를 따른다. 실제 운영 기준은 [수용 기준](ACCEPTANCE.md#5-2027-시범-운영-게이트)과 함께 확인한다.
