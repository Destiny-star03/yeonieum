import WorkspaceIcon from "../workspace/WorkspaceIcon";
const entries = [
  {
    id: "documents",
    tag: "자료실",
    title: "필요한 자료를 한곳에",
    description: "업무 자료를 모으고, 새 버전과 이전 기록을 함께 관리하세요.",
    action: "자료실로 이동",
    art: "files",
  },
  {
    id: "budgets",
    tag: "예산 · 정산",
    title: "예산부터 정산까지",
    description: "단체별 예산과 실제 지출, 증빙과 정산 현황을 확인하세요.",
    action: "예산·정산으로 이동",
    art: "budget",
  },
  {
    id: "handovers",
    tag: "인수인계",
    title: "다음 담당자에게 이어주세요",
    description: "업무와 자료를 연결하고, 인수 확인까지 차근차근 남기세요.",
    action: "인수인계로 이동",
    art: "handover",
  },
] as const;
function Illustration({ kind }: { kind: "files" | "budget" | "handover" }) {
  return (
    <div className={`quick-art quick-art-${kind}`} aria-hidden="true">
      {kind === "files" ? (
        <>
          <div className="art-file-back">
            <span />
            <span />
            <span />
          </div>
          <div className="art-file-front">
            <WorkspaceIcon name="documents" />
            <i />
            <i />
            <b>우리의 활동 기록</b>
          </div>
          <span className="art-float">v1 → v2</span>
        </>
      ) : kind === "budget" ? (
        <>
          <div className="art-ledger">
            <span>업무 예산 관리</span>
            <div className="art-bars">
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="art-ledger-line" />
          </div>
          <span className="art-seal">
            <WorkspaceIcon name="budgets" />
          </span>
        </>
      ) : (
        <>
          <div className="art-person art-person-first">
            <span />
            <i />
            <i />
          </div>
          <div className="art-transfer">
            <WorkspaceIcon name="handovers" />
          </div>
          <div className="art-person art-person-last">
            <span />
            <i />
            <i />
          </div>
          <span className="art-float">기록을 이어서</span>
        </>
      )}
    </div>
  );
}
export default function QuickStart({
  onNavigate,
}: {
  onNavigate: (tab: string) => void;
}) {
  return (
    <section className="quick-start" aria-labelledby="quick-start-title">
      <div className="quick-start-intro">
        <span className="quick-start-tag">시작하기</span>
        <h2 id="quick-start-title">
          오늘의 업무를
          <br />
          한곳에서
        </h2>
        <p>
          기록부터 인수인계까지,
          <br />
          필요한 업무를 바로 시작하세요.
        </p>
      </div>
      <div className="quick-start-cards">
        {entries.map((entry) => (
          <button
            className="quick-card"
            key={entry.id}
            aria-label={entry.action}
            onClick={() => onNavigate(entry.id)}
          >
            <Illustration kind={entry.art} />
            <div className="quick-card-copy">
              <span className="quick-card-tag">{entry.tag}</span>
              <h3>{entry.title}</h3>
              <p>{entry.description}</p>
              <span className="quick-card-link">
                {entry.action}
                <WorkspaceIcon name="arrow" />
              </span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
