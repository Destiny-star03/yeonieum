# 연이음 웹 앱

화면과 사용자 상호작용의 시작 디렉터리다. 현재 실행 가능한 앱은 없다. React·TypeScript는 기존 권장안이며 의존성·런타임·빌드 도구는 선택 후 이곳에 추가한다.

- `src/features`: access, organizations, documents, budgets, handovers 등 실제 구현하는 기능별 UI·상태·API 호출.
- `src/shared`: 여러 기능에서 실제 재사용하는 UI·기반 코드.
- `public`: 공개 가능한 정적 자산. 내부 문서·영수증은 포함하지 않는다.
- `tests`: 웹 통합 테스트. 단위 테스트는 기능 가까이에 둔다.

첫 화면을 구현할 때 package.json과 lockfile, 린트·포맷·타입 검사·테스트 설정을 추가하고 검증한 실행 명령을 이 문서에 기록한다. 저장소 전체 규칙은 [기여 가이드](../../CONTRIBUTING.md), 기능 경계는 [구조 안내](../../docs/PROJECT_STRUCTURE.md)를 따른다.
