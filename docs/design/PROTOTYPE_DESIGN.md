# 1차 상세 설계와 프로토타입 경계

2026-11-12. [도메인 모델](../DOMAIN_MODEL.md), [기능명세](../FUNCTIONAL_SPEC.md), [권한 명세](../ACCESS_CONTROL.md)를 기준으로 한다. 구현 범위는 M-01~03 및 역할 회수·감사 부분이다. 자료·회계·인수인계는 아래 논리 설계 단계이며 실행 코드가 있다고 해석하지 않는다.

## 구현된 데이터 관계

```mermaid
erDiagram
    user ||--o{ membership : participates
    unit ||--o{ membership : includes
    unit o|--o{ unit : parent
    user ||--o{ assignment : holds
    unit ||--o{ assignment : scopes
    assignment o|--o{ assignment : prerequisite
    user ||--o{ session : authenticates
    user ||--o{ audit : acts
    user {
        string id PK
        string identifier UK
        string email UK
        string name
        string phone
        bool isAdmin
        bool active
    }
    unit {
        string id PK
        string orgId FK
        string parentId FK
        string kind
        string name
    }
    assignment {
        string id PK
        string userId FK
        string unitId FK
        string role
        datetime startsAt
        datetime endsAt
        datetime activatedAt
        string prerequisiteId FK
        string electionNote
        datetime revokedAt
    }
    session {
        string tokenHash PK
        string userId FK
        datetime expiresAt
    }
```

단체·학과·학년·반은 unit의 서로 다른 종류다. 동일 상위 단위·종류·이름은 중복 생성하지 않는다. 공식 임기는 시작 포함·종료 미포함이며 모든 API의 저장 시각은 UTC다. 화면은 사용자 기기의 한국 시간 환경에서 표시한다. 학년도는 권한 판정의 임기가 아니다.

의장은 본인의 학회장 assignment를 전제로 가지며 공식 시작·종료가 일치해야 한다. activatedAt은 서버가 서비스 역할을 부여한 시각으로 별도 기록한다. 현재 유효한 학회장 자격과 선출 확인 메모가 있어야 선생님이 의장 권한을 부여할 수 있다. 최초 학회장 등록은 선생님이 수행한다(DM-C06). 실제 투표는 포털 밖의 사실이며 투표 기능은 구현하지 않았다.

## 후속 핵심 기능의 논리 ERD

아래 엔터티는 계획이다. 물리 스키마·마이그레이션은 해당 기능 구현 때 확정한다.

```mermaid
erDiagram
    organization ||--o{ organizationTerm : classifies
    organizationTerm ||--o{ document : retains
    document ||--|{ documentVersion : versions
    organizationTerm ||--o| annualBudget : budgets
    annualBudget ||--o{ eventAllocation : allocates
    eventAllocation ||--o{ expense : spends
    expense ||--|{ expenseRevision : records
    expenseRevision ||--o{ evidenceLink : attaches
    documentVersion ||--o{ evidenceLink : supports
    expenseRevision ||--o{ expenseReview : reviews
    expenseRevision ||--o{ overBudgetReview : excepts
    organizationTerm ||--o{ settlement : finalizes
    organization ||--o{ handover : transfers
    handover ||--o{ handoverItem : contains
    documentVersion o|--o{ handoverItem : references
    settlement o|--o{ handoverItem : references
```

지출의 등록자·실제 집행자·확인자를 구분한다. 행사 배정과 지출의 범위·운영기는 일치해야 하며, 증빙은 허용된 같은 단체의 특정 버전으로 연결한다. 인수인계는 같은 단체의 다른 운영기 또는 같은 운영기의 중도 교체를 수용한다. 자료·예산·감사 이력은 담당자 종료로 연쇄 삭제하지 않는다.

## 역할별 현재 권한

| 주체 | 계정·역할 등록 | 조회·감사 |
|---|---|---|
| 담당 선생님 | 최초 학회장과 4개 최고 책임자 등록, 역할 회수 | 전체 가상 담당자·연락처·감사 |
| 의장 | 협의회 하위 학회장·부학회장·반대표 | 협의회 담당자·연락처·감사, 자신의 학회장 범위 겸임 |
| 학회장 | 자기 학과의 부학회장·반대표 | 자기 학과 담당자·연락처. 전체 감사는 불가 |
| 학생회장·국장·연합동아리장 | 자기 단체에 맞는 하위 역할 | 자기 단체 담당자·연락처·감사 |
| 그 밖의 하위 담당자 | 재위임 불가 | 자기 담당 범위의 명단, 자신의 연락처와 최고 책임자 연락처 |
| 역할 미부여 계정 | 등록·부여 불가 | 본인 정보·최고 책임자 연락처만 |

서비스 관리자 계정의 생성·교체는 아직 관리 화면으로 제공하지 않는다. 학생 계정의 기존 소속 변경·계정 비활성화·회계 입력 권한은 후속이다. 최고 책임자·학회장·반대표 동일 범위의 겹치는 재임은 이 프로토타입에서 차단하는 임시 선택(P)이며 실제 정원·대행 정책은 DM-O01에서 확정한다.

## 지출 확인과 초과분 처리 설계

```mermaid
stateDiagram-v2
    [*] --> Pending: 실제 지출 등록
    Pending --> Reviewed: 권한자의 개별 확인
    Pending --> Rejected: 사유와 함께 반려
    Rejected --> Pending: 보완 후 새 검토 회차
```

이 상태 변화는 실제 사용 사실을 지우지 않는다. 실제 집행 기준 잔액 = 예산 − 해당 범위의 실제 지출 현재 반영액이다. 검토 대기·확인 완료·반려 금액은 별도 집계하고 다시 차감하지 않는다. 예산 100,000원에 실제 120,000원이면 잔액 -20,000원·초과 20,000원이다. 수정 회차를 중복 합산하지 않는다(DM-C04).

```mermaid
flowchart TD
    expense["실제 발생한 초과 지출 기록"] --> ownerCheck{"실제 집행자가 해당 단체 최고 책임자인가"}
    ownerCheck -->|"예"| staff["담당 선생님이 초과분 최종 확인"]
    ownerCheck -->|"아니오"| head["해당 단체 최고 책임자가 초과분 최종 확인"]
    staff --> outcome["처리 결과와 이력 기록"]
    head --> outcome
```

대리 등록자는 이 경로를 바꾸지 않는다. 초과분 확인은 예산 자동 증액이나 전체 정산 확정이 아니다. 결과의 세부 종류·환불·정정 반영 시점은 DM-O02 미정이다.

```mermaid
stateDiagram-v2
    [*] --> Open
    Open --> Finalized: 선생님이 미처리 항목을 모두 처리한 후 확정
```

정산 확정 뒤 원본을 덮어쓰지 않고 별도 정정 이력을 남기는 설계다. 미처리의 세부 판정과 정정 승인자는 회계 구현 전 결정한다.

## 인수인계 상태 설계

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> Submitted: 자료 버전과 업무 항목 연결
    Submitted --> Waiting: 후임 역할 승인과 인수 확인 대기
    Waiting --> Completed: 역할 승인과 모든 필수 인수 확인 완료
```

역할 승인과 인수 확인은 별도 기록한다. 대리 작성자가 인수자를 대신해 필수 확인을 끝내지 못한다. 자료 원본과 지출을 새 담당자의 새 기록으로 복제하지 않는다.

## 로컬 실행 구조

```mermaid
flowchart LR
    browser["브라우저 127.0.0.1:5173"] --> web["React와 Vite"]
    web -->|"동일 출처 API 프록시"| api["FastAPI 127.0.0.1:8000"]
    api --> policy["현재 역할과 범위 및 임기 검사"]
    api --> database["local-data SQLite"]
    policy --> database
```

고정된 가상 비밀번호·로컬 HTTP 쿠키·샘플 계정은 데모 전용이다. 외부 네트워크에 노출하거나 실데이터를 반입하지 않는다. 운영에는 Cognito 등 인증, HTTPS, 세션·계정 복구·로그인 제한, PostgreSQL 마이그레이션·동시성·백업 복구, AWS 연결을 별도 검증한다. [FastAPI 보안 문서](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/), [React 시작 지침](https://react.dev/learn/build-a-react-app-from-scratch), [Vite 안내](https://vite.dev/guide/)를 참고했다.
