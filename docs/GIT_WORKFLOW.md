# 연이음 Git 협업·배포 규칙

적용일: 2026-11-12. 이 프로젝트는 GitHub와 GitHub Actions를 사용한다. `main`은 운영 배포 기준, `develop`은 개발 통합, 작업은 별도 브랜치에서 진행한다. 현재 로컬 조직·권한 앱과 검사 CI가 있으며 AWS·운영 CD는 미구성 상태다.

## 브랜치와 PR 경로

| 브랜치 | 기준·역할 | PR 대상 |
|---|---|---|
| main | 검증된 운영 배포 기준. 직접 커밋·푸시 금지 | develop으로 hotfix 결과 동기화 가능 |
| develop | 개발 통합. 직접 커밋·푸시 금지 | 검증 후 main |
| feature/기능명 | 최신 origin/develop에서 새 기능·문서·설정 작업 | develop |
| bugfix/문제명 | 최신 origin/develop에서 일반 오류 수정 | develop |
| hotfix/문제명 | 최신 origin/main에서 긴급 수정 | main, 이후 develop에도 반영 |
| release/버전 | 필요할 때 develop에서 배포 준비 | main, 필요한 수정은 develop에도 반영 |

작업 이름은 소문자 kebab-case를 사용한다. 예: `feature/login`, `feature/git-workflow`, `bugfix/login-error`, `hotfix/auth-error`. release에는 `release/0.1.0`도 허용한다. `feature-login`과 `feature/login`을 섞지 않는다.

기존 `ci/repository-quality`는 초기 설정 이력으로 남긴다. 검증된 구조 커밋 `fb0736c`를 최초 develop 기준으로 생성했다. 이후 작업은 이 문서의 브랜치를 사용한다. 초기 생성은 1회 설정이며 develop에 직접 변경을 계속 푸시하는 예외가 아니다.

## 작업 시작

처음 받는 경우만 clone한다. 이미 저장소가 있으면 같은 폴더를 재사용한다. 아래는 작업 트리가 깨끗한 상태에서 새 기능을 시작하는 예시다.

```bash
git clone https://github.com/Destiny-star03/yeonieum.git
cd yeonieum
git status --short
git fetch --prune origin
git switch develop
git pull --ff-only origin develop
git switch --no-track -c feature/login origin/develop
```

처음 로컬 develop이 없다면 `git switch --track origin/develop`을 사용한다. 미커밋 변경이 있으면 먼저 소유자와 내용을 확인한다. 임의 stash·discard·hard reset을 하지 않는다. `git pull origin develop`을 기능 브랜치에서 그대로 실행하지 않는다. 최신화 대상과 현재 브랜치를 구분하고, fast-forward가 불가능하면 이력을 확인한 후 필요한 병합을 수행한다.

## 커밋 규칙

형식은 `type: 설명` 또는 `type(scope): 설명`, 제목은 72자 이내다. 한국어·영어 설명 모두 허용한다.

| 타입 | 용도 |
|---|---|
| feat | 기능 추가 |
| fix | 오류 수정 |
| docs | 문서 수정 |
| style | 동작을 바꾸지 않는 서식 |
| refactor | 구조 개선 |
| test | 테스트 |
| chore | 개발 도구·기타 관리 |
| ci | CI 설정·자동 검사 |
| revert | 변경 되돌리기 |

한 커밋에는 검토·되돌리기가 가능한 한 가지 목적을 담는다. 예: `feat(access): 로그인 추가`, `fix(budgets): 잔액 계산 수정`. `update code`, `fix bug`는 허용하지 않는다. Git이 실제 병합 과정에서 생성한 merge commit은 일반 제목 검사에서 제외한다.

## 로컬 검사와 훅

[개발 가이드](../CONTRIBUTING.md)의 가상환경을 준비한 뒤 실행한다.

```bash
python -m pip install -r requirements-dev.txt
python -m pre_commit install
python -m pre_commit run --all-files --show-diff-on-failure
python -m unittest discover -s tests/unit -p 'test_*.py' -v
```

`pre_commit install`은 pre-commit과 commit-msg 훅을 함께 설치한다. commit-msg 훅은 main/develop에서 직접 커밋을 차단하고 제목 규칙을 검사한다. 앱 전용 린트·빌드·테스트는 실제 코드·도구 도입 때 연결한다. 훅 실패는 수정해서 해결하며 기본 절차에서 `--no-verify`로 우회하지 않는다.

## 작업 종료와 PR

변경을 확인하고 해당 작업 파일만 스테이징한다. 아래는 현재 Git 규칙 작업의 예시다.

```bash
git status --short
git diff
git add docs/GIT_WORKFLOW.md scripts/check_git_policy.py
git diff --cached --check
git commit -m "chore: add Git collaboration policy"
git push -u origin feature/git-workflow
```

PR은 feature/bugfix에서 develop으로 연다. 제목도 커밋 형식을 따르고, 문제·변경 동작·관련 Issue/요구 ID·검증 결과·영향을 [PR 양식](../.github/PULL_REQUEST_TEMPLATE.md)에 기록한다. 비어 있거나 실행하지 않은 검증을 성공으로 표시하지 않는다.

필수 CI는 `repository-checks`, `git-policy`, `api-tests`, `web-checks`다. API는 Ruff·통합 테스트, 웹은 서식·타입·빌드·브라우저 검사를 수행한다. 후자는 브랜치 이름·PR 대상·PR 제목과 새 일반 커밋을 검사한다. 공식 main/develop 경로는 원본 저장소의 브랜치인지도 확인한다. PR 제목 수정에도 재실행하며, 신뢰하지 않는 PR 제목·브랜치를 셸 문자열에 직접 삽입하지 않는다. Git 초기 이력을 소급해 새 규칙으로 수정하지 않는다.

검토와 CI 완료 후 PR로 병합한다. main에 대한 기능 브랜치 직접 PR은 막고 develop·release·hotfix만 허용한다. hotfix는 main과 develop 양쪽에 반영한 뒤 정리한다. 병합 방법은 Git 이력과 팀 규칙에 맞춰 선택하며, 기본적으로 merge commit을 사용해 작은 커밋을 보존한다.

원격 PR의 병합 상태와 필요한 대상 반영을 확인한 후 작업 브랜치를 삭제한다. main/develop과 미병합 브랜치는 삭제하지 않는다. 로컬 `git branch -d`가 거부되면 원인을 확인하고 자동으로 `-D`로 바꾸지 않는다.

## 서버 측 권한과 보호

[branch-quality 설정](../infra/github/branch-quality.json)은 main/develop에 PR·네 CI 성공·최신 기준 반영·검토 대화 해결을 요구하고, 강제 푸시와 삭제를 제한한다. 이 품질 규칙에는 우회자를 두지 않는다.

[main-maintainer 설정](../infra/github/main-maintainer.json)은 main 갱신을 현 운영 책임자 `Destiny-star03`의 PR 병합으로 제한한다. PR 전용 예외는 이 갱신 제한에만 적용하고 별도 품질 규칙은 그대로 적용한다. develop은 쓰기 권한이 있는 개발자가 PR·CI 조건 충족 후 병합한다.

현재 협업자는 소유자 1명이므로 필수 승인 수는 0명이다. PR 검토 절차는 유지하며, 별도 리뷰어가 참여하면 최소 1명 승인으로 보호 설정을 갱신한다. 본인 PR의 승인을 본인에게 요구해 병합 불가능한 설정을 만들지 않는다. 서비스의 담당 선생님 역할과 GitHub 저장소 운영 권한은 별개다.

설정 파일만으로 서버 보호가 적용되지는 않는다. GitHub API에 적용한 결과를 읽어서 파일과 일치하는지 확인한다. 설정을 바꿀 때 관련 문서도 갱신한다. 보호 조건을 충족하지 못하면 무조건 관리자 우회·강제 푸시로 해결하지 않는다.

## 배포 경계

현재 CI는 검사만 하며 배포 명령·서버 자격증명이 없다. 앞으로 develop은 테스트 환경, main은 운영 배포 기준으로 사용한다. 실제 AWS 계정·앱·IaC와 복구 방법을 정한 뒤 테스트 배포를 구성한다.

운영 CD는 별도 production 환경 승인과 운영 책임자의 권한으로 실행하도록 설계한다. AWS 역할·OIDC 신뢰 조건과 배포 자격증명을 분리해야 실제 운영 배포 권한이 제한된다. main 병합 권한만으로 서버 접근 권한까지 통제했다고 주장하지 않는다.

사용자가 제공한 Forgejo/Woodpecker·Apache 재시작·서버 git pull 예시는 다른 환경의 설명이다. 연이음에 가짜 SSH 대상이나 동작하지 않는 배포 작업을 추가하지 않는다. GitHub Actions의 검사와 향후 AWS 배포를 구분한다.

## 참고

- [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
- [pre-commit 훅](https://pre-commit.com/)
- [GitHub ruleset](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository)
