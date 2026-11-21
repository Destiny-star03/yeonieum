import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { api } from "../../shared/api";
import "./budgets.css";
import ExpenseDialog from "./ExpenseDialog";
import OrganizationCards, { useOrganizationOrder } from "./OrganizationCards";

type Person = { id: string; name: string };
type Money = {
  budget: number;
  actual: number;
  remaining: number;
  excess: number;
  pending: number;
  approved: number;
  rejected: number;
};
type Expense = {
  id: string;
  event_id: string | null;
  spent_on: string;
  purpose: string;
  amount: number;
  executor_id: string;
  executor_name: string;
  review_state: string;
  exception_state: string;
  executor_was_head: number;
  exception_requires_teacher: boolean;
  evidence_count: number;
  revision: number;
  balance_before: number;
  balance_after: number;
  changes: {
    id: string;
    reason: string;
    before_json: string;
    after_json: string;
  }[];
};
type BudgetDetail = {
  budget: {
    amount: number;
    revision: number;
    settled_at: string | null;
  } | null;
  events: {
    id: string;
    name: string;
    allocation: number;
    revision: number;
    totals: Money;
  }[];
  expenses: Expense[];
  totals: Money | null;
  capabilities: Record<string, boolean>;
  is_head: boolean;
  is_admin: boolean;
  settlements: { id: string; created_at: string }[];
};
type Options = {
  organizations: { id: string; name: string }[];
  people: Record<string, Person[]>;
  grants: {
    user_id: string;
    org_id: string;
    capability: string;
    active: number;
  }[];
};
type Evidence = { id: string; filename: string; size: number };
const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const labels: Record<string, string> = {
  view: "회계 내역 열람",
  plan: "예산 편성",
  record: "지출 기록·정정",
  review: "개별 지출 검토",
  evidence: "민감 증빙 열람·등록",
};

export default function BudgetWorkspace({
  user,
}: {
  user: Person & { is_admin?: number };
}) {
  const [options, setOptions] = useState<Options>({
    organizations: [],
    people: {},
    grants: [],
  });
  const [org, setOrg] = useState("");
  const organizationOrder = useOrganizationOrder(user.id);
  const [year, setYear] = useState(new Date().getFullYear());
  const [detail, setDetail] = useState<BudgetDetail | null>(null);
  const [selected, setSelected] = useState("");
  const [editingEvent, setEditingEvent] = useState("");
  const [settlement, setSettlement] = useState<{
    created_at: string;
    snapshot: BudgetDetail;
  } | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [overview, setOverview] = useState<
    {
      org_id: string;
      name: string;
      configured: boolean;
      settled: boolean;
      expense_count: number;
      totals: Money;
    }[]
  >([]);
  const [authorizeHeads, setAuthorizeHeads] = useState(true);
  const [expenseDraft, setExpenseDraft] = useState<{
    org: string;
    year: number;
    detail: BudgetDetail;
    people: Person[];
  } | null>(null);
  const latestRequest = useRef(0);
  const expenseRequest = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const requestId = ++latestRequest.current;
    const [next, summary] = await Promise.all([
      api<Options>("/budgets/options"),
      api<{ items: typeof overview }>(`/budgets/overview?year=${year}`),
    ]);
    if (requestId !== latestRequest.current) return;
    setOptions(next);
    setOverview(summary.items);
    const chosen = next.organizations.some((item) => item.id === org)
      ? org
      : next.organizations[0]?.id || "";
    if (chosen !== org) setOrg(chosen);
    setDetail(null);
    if (chosen) {
      const result = await api<BudgetDetail>(`/budgets/${chosen}/${year}`);
      if (requestId === latestRequest.current) setDetail(result);
    }
  }, [org, year]);
  useEffect(() => {
    let live = true;
    setError("");
    if (!Number.isInteger(year) || year < 2000 || year > 2200) {
      ++latestRequest.current;
      setDetail(null);
      setOverview([]);
      return;
    }
    refresh().catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [refresh]);

  async function perform(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await refresh();
      setNotice(success);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const values = (e: FormEvent<HTMLFormElement>) =>
    Object.fromEntries(new FormData(e.currentTarget));
  async function submitAnnual(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = values(e);
    await perform(
      () =>
        api("/budgets/annual", {
          org_id: org,
          year,
          amount: Number(v.amount),
          expected_revision: detail?.budget?.revision ?? null,
          authorize_heads: Boolean(user.is_admin && authorizeHeads),
        }),
      "연간 예산을 저장했습니다.",
    );
  }
  async function submitEvent(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const v = values(e);
    const saved = await perform(
      () =>
        api("/budgets/events", {
          org_id: org,
          year,
          name: v.name,
          allocation: Number(v.allocation),
        }),
      "행사 배정을 저장했습니다.",
    );
    if (saved) form.reset();
  }
  async function updateEvent(
    e: FormEvent<HTMLFormElement>,
    event: BudgetDetail["events"][number],
  ) {
    e.preventDefault();
    const v = values(e);
    const saved = await perform(
      () =>
        api("/budgets/events", {
          org_id: org,
          year,
          event_id: event.id,
          expected_revision: event.revision,
          name: v.name,
          allocation: Number(v.allocation),
        }),
      "행사 배정 변경을 기록했습니다.",
    );
    if (saved) setEditingEvent("");
  }
  async function submitExpense(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const v = values(e);
    const requestId = expenseRequest.current || crypto.randomUUID();
    expenseRequest.current = requestId;
    const saved = await perform(
      () =>
        api("/budgets/expenses", {
          request_id: requestId,
          org_id: org,
          year,
          event_id: v.event_id || null,
          spent_on: v.spent_on,
          purpose: v.purpose,
          amount: Number(v.amount),
          executor_id: v.executor_id,
        }),
      "실제 지출을 기록했습니다. 증빙을 첨부해 주세요.",
    );
    if (saved) {
      expenseRequest.current = null;
      form.reset();
    }
  }
  async function submitCorrection(e: FormEvent<HTMLFormElement>, row: Expense) {
    e.preventDefault();
    const v = values(e);
    await perform(
      () =>
        api(`/budgets/expenses/${row.id}/correct`, {
          amount: Number(v.amount),
          purpose: v.purpose,
          reason: v.reason,
          expected_revision: row.revision,
        }),
      "정정 이력을 남겼습니다. 검토가 다시 필요합니다.",
    );
  }
  async function decision(
    row: Expense,
    kind: "review" | "exception",
    answer: string,
  ) {
    const reason = window.prompt(
      answer === "approved"
        ? "확인 사유를 입력해 주세요."
        : "반려 사유를 입력해 주세요.",
    );
    if (!reason || reason.trim().length < 2) return;
    await perform(
      () =>
        api(`/budgets/expenses/${row.id}/${kind}`, {
          decision: answer,
          reason,
          expected_revision: row.revision,
        }),
      "처리 결과와 사유를 기록했습니다.",
    );
  }
  async function uploadEvidence(row: Expense, file: File) {
    await perform(async () => {
      const response = await fetch(
        `/api/budgets/expenses/${row.id}/evidence?filename=${encodeURIComponent(file.name)}`,
        {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/octet-stream" },
          body: file,
        },
      );
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.detail || "증빙 등록에 실패했습니다.");
      }
    }, "증빙을 안전하게 등록했습니다.");
  }
  async function showEvidence(row: Expense) {
    setError("");
    setSelected(row.id);
    try {
      setEvidence(
        await api<Evidence[]>(`/budgets/expenses/${row.id}/evidence`),
      );
    } catch (e) {
      setEvidence([]);
      setError((e as Error).message);
    }
  }
  async function download(item: Evidence) {
    try {
      const response = await fetch(
        `/api/budgets/evidence/${item.id}/download`,
        { credentials: "same-origin" },
      );
      if (!response.ok) throw new Error("현재 증빙 열람 권한을 확인해 주세요.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = item.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const people = [...(options.people[org] || [])];
  if (user.is_admin && !people.some((p) => p.id === user.id))
    people.push({ id: user.id, name: user.name });
  const current = detail?.expenses.find((e) => e.id === selected);
  const settled = Boolean(detail?.budget?.settled_at);
  return (
    <div className="finance-page">
      <section className="panel finance-overview-panel">
        <h2>단체별 연간 예산</h2>
        <p className="muted">
          실제 집행액은 검토·반려와 무관하게 한 번만 합산합니다. 회계 업무
          권한은 별도 지정합니다.
        </p>
        <div className="finance-controls">
          <label>
            단체{" "}
            <select
              value={org}
              onChange={(e) => {
                setOrg(e.target.value);
                setSelected("");
                setSettlement(null);
                setDetail(null);
                expenseRequest.current = null;
              }}
            >
              <option value="">선택</option>
              {organizationOrder.arrange(options.organizations).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            연도{" "}
            <input
              type="number"
              min="2000"
              max="2200"
              value={year}
              onChange={(e) => {
                setYear(Number(e.target.value));
                setSelected("");
                setSettlement(null);
                setDetail(null);
                expenseRequest.current = null;
              }}
            />
          </label>
        </div>
        {overview.length > 0 && (
          <OrganizationCards
            items={organizationOrder.arrange(
              overview.map((item) => ({
                id: item.org_id,
                name: item.name,
                configured: item.configured,
                budget: item.totals.budget,
                remaining: item.totals.remaining,
                actual: item.totals.actual,
                count: item.expense_count,
                settled: item.settled,
              })),
            )}
            selected={org}
            onSelect={(id) => {
              setOrg(id);
              setDetail(null);
              setSelected("");
              setSettlement(null);
            }}
            onMove={organizationOrder.move}
            message={organizationOrder.message}
          />
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="success" role="status">
            {notice}
          </p>
        )}
        {detail?.totals && (
          <div className="finance-metrics">
            {Object.entries(detail.totals).map(([key, value]) => (
              <div key={key}>
                <small>
                  {
                    {
                      budget: "연간 예산",
                      actual: "실제 집행",
                      remaining: "잔액",
                      excess: "초과액",
                      pending: "검토 대기",
                      approved: "확인 완료",
                      rejected: "반려",
                    }[key as keyof Money]
                  }
                </small>
                <strong>{won(value)}</strong>
              </div>
            ))}
          </div>
        )}
        {detail?.totals && (
          <div className="finance-usage">
            <div>
              <strong>예산 사용률</strong>
              <span>
                {detail.totals.budget > 0
                  ? `${Math.round((detail.totals.actual / detail.totals.budget) * 100)}%`
                  : detail.totals.actual
                    ? "예산 초과"
                    : "0%"}
              </span>
            </div>
            <progress
              aria-label="연간 예산 사용률"
              max={Math.max(detail.totals.budget, detail.totals.actual, 1)}
              value={detail.totals.actual}
            />
            <p>
              사용 {won(detail.totals.actual)} · 남은 예산{" "}
              {won(detail.totals.remaining)}
              {detail.totals.excess > 0
                ? ` · 초과 ${won(detail.totals.excess)}`
                : ""}
            </p>
          </div>
        )}
        {settled && (
          <p className="success">정산 확정 · {detail?.budget?.settled_at}</p>
        )}
        {detail?.capabilities.plan && !settled && (
          <form onSubmit={submitAnnual} className="finance-inline">
            <label>
              연간 예산 (원){" "}
              <input
                name="amount"
                type="number"
                min="0"
                required
                defaultValue={detail.budget?.amount ?? 0}
                key={`${org}-${year}-${detail.budget?.revision}`}
              />
            </label>
            {Boolean(user.is_admin) && (
              <label className="finance-check">
                <input
                  type="checkbox"
                  checked={authorizeHeads}
                  onChange={(e) => setAuthorizeHeads(e.target.checked)}
                />
                현재 단체 책임자에게 지출·증빙 등록 권한 함께 부여
              </label>
            )}
            <button disabled={busy}>저장</button>
          </form>
        )}
      </section>
      {Boolean(user.is_admin) && org && (
        <section className="panel finance-grant-panel">
          <details>
            <summary>회계 업무 권한 관리</summary>
            <h2>단체별 회계 업무 권한</h2>
            <p className="muted">
              직책이나 일반 자료 권한으로 자동 부여되지 않습니다. 증빙 권한은
              별도로 지정합니다.
            </p>
            <div className="finance-grants">
              {people.map((person) => (
                <div key={person.id}>
                  <strong>{person.name}</strong>
                  {Object.entries(labels).map(([capability, label]) => {
                    const enabled = options.grants.some(
                      (g) =>
                        g.user_id === person.id &&
                        g.org_id === org &&
                        g.capability === capability &&
                        g.active,
                    );
                    const builtInPlan = Boolean(
                      user.is_admin &&
                      person.id === user.id &&
                      capability === "plan",
                    );
                    return (
                      <label key={capability}>
                        <input
                          type="checkbox"
                          checked={enabled || builtInPlan}
                          disabled={busy || builtInPlan}
                          onChange={(e) =>
                            perform(
                              () =>
                                api("/budgets/grants", {
                                  user_id: person.id,
                                  org_id: org,
                                  capability,
                                  enabled: e.target.checked,
                                }),
                              "회계 업무 권한을 변경했습니다.",
                            )
                          }
                        />
                        {label}
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          </details>
        </section>
      )}
      {detail?.budget && (
        <>
          <section className="panel">
            <h2>행사 배정</h2>
            <div className="finance-list">
              {detail.events.map((event) => (
                <div key={event.id}>
                  <strong>{event.name}</strong>
                  <span>
                    배정 {won(event.allocation)} · 집행{" "}
                    {won(event.totals.actual)} · 잔액{" "}
                    {won(event.totals.remaining)}
                  </span>
                  {detail.capabilities.plan && !settled && (
                    <button
                      onClick={() =>
                        setEditingEvent(
                          editingEvent === event.id ? "" : event.id,
                        )
                      }
                    >
                      배정 수정
                    </button>
                  )}
                  {editingEvent === event.id && (
                    <form
                      className="finance-inline"
                      onSubmit={(e) => updateEvent(e, event)}
                    >
                      <label>
                        행사명{" "}
                        <input name="name" defaultValue={event.name} required />
                      </label>
                      <label>
                        배정액{" "}
                        <input
                          name="allocation"
                          type="number"
                          min="0"
                          defaultValue={event.allocation}
                          required
                        />
                      </label>
                      <button disabled={busy}>변경 저장</button>
                    </form>
                  )}
                </div>
              ))}
            </div>
            {detail.capabilities.plan && !settled && (
              <form onSubmit={submitEvent} className="finance-inline">
                <label>
                  행사명 <input name="name" maxLength={120} required />
                </label>
                <label>
                  배정액{" "}
                  <input name="allocation" type="number" min="0" required />
                </label>
                <button disabled={busy}>행사 등록</button>
              </form>
            )}
          </section>
          {detail.capabilities.record && !settled && (
            <section className="panel">
              <h2>실제 지출 기록</h2>
              <p className="muted">
                영수증·엑셀·지출결의서를 첨부하고 금액을 확인하세요. 저장하면
                사용액과 잔액에 반영합니다.
              </p>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  setExpenseDraft({
                    org,
                    year,
                    detail,
                    people: options.people[org] || [],
                  })
                }
              >
                ＋ 지출·증빙 등록
              </button>
              <details className="finance-legacy-entry">
                <summary>증빙 없이 지출 먼저 기록</summary>
                <form onSubmit={submitExpense} className="finance-form">
                  <label>
                    집행일 <input name="spent_on" type="date" required />
                  </label>
                  <label>
                    실제 집행자{" "}
                    <select name="executor_id" required>
                      <option value="">선택</option>
                      {(options.people[org] || []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    행사{" "}
                    <select name="event_id">
                      <option value="">연간 일반 지출</option>
                      {detail.events.map((event) => (
                        <option key={event.id} value={event.id}>
                          {event.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    금액 (원){" "}
                    <input name="amount" type="number" min="1" required />
                  </label>
                  <label className="wide">
                    용도 <input name="purpose" maxLength={300} required />
                  </label>
                  <button disabled={busy}>지출 기록</button>
                </form>
              </details>
            </section>
          )}
          <section className="panel">
            <h2>지출과 검토</h2>
            {detail.expenses.length === 0 && (
              <p className="muted">기록된 지출이 없습니다.</p>
            )}
            <div className="finance-list">
              {detail.expenses.map((row) => (
                <div key={row.id}>
                  <button
                    className="finance-row"
                    onClick={() => {
                      setSelected(row.id === selected ? "" : row.id);
                      setEvidence([]);
                    }}
                  >
                    <strong>{row.purpose}</strong>
                    <span>
                      {row.spent_on} · {row.executor_name} 집행 ·{" "}
                      {won(row.amount)} ·{" "}
                      {row.review_state === "pending"
                        ? "검토 대기"
                        : row.review_state === "approved"
                          ? "확인"
                          : "반려"}
                      {row.exception_state !== "none" &&
                        ` · 초과 ${row.exception_state === "pending" ? "확인 대기" : row.exception_state === "approved" ? "확인" : "반려"}`}{" "}
                      · 증빙 {row.evidence_count}건
                    </span>
                    <small className="finance-balance-change">
                      {won(row.balance_before)} − {won(row.amount)} = 잔액{" "}
                      {won(row.balance_after)}
                    </small>
                  </button>
                </div>
              ))}
            </div>
            {current && (
              <div className="finance-detail">
                <h3>{current.purpose}</h3>
                <p className="muted">
                  등록자와 실제 집행자는 구분됩니다. 반려해도 실제 지출액과
                  잔액은 유지됩니다.
                </p>
                {detail.capabilities.review &&
                  current.review_state === "pending" &&
                  !settled && (
                    <div className="finance-actions">
                      <button
                        disabled={busy}
                        onClick={() => decision(current, "review", "approved")}
                      >
                        개별 확인
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => decision(current, "review", "rejected")}
                      >
                        반려
                      </button>
                    </div>
                  )}
                {current.exception_state === "pending" &&
                  !settled &&
                  ((current.exception_requires_teacher && detail.is_admin) ||
                    (!current.exception_requires_teacher &&
                      detail.is_head &&
                      user.id !== current.executor_id)) && (
                    <div className="finance-actions">
                      <button
                        disabled={busy}
                        onClick={() =>
                          decision(current, "exception", "approved")
                        }
                      >
                        초과분 확인
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          decision(current, "exception", "rejected")
                        }
                      >
                        초과분 반려
                      </button>
                    </div>
                  )}
                {detail.capabilities.record && !settled && (
                  <form
                    onSubmit={(e) => submitCorrection(e, current)}
                    className="finance-inline"
                  >
                    <label>
                      현재 반영 금액{" "}
                      <input
                        name="amount"
                        type="number"
                        min="0"
                        defaultValue={current.amount}
                        required
                        key={current.revision}
                      />
                    </label>
                    <label>
                      용도{" "}
                      <input
                        name="purpose"
                        defaultValue={current.purpose}
                        required
                      />
                    </label>
                    <label>
                      정정 사유 <input name="reason" minLength={2} required />
                    </label>
                    <button disabled={busy}>정정 기록</button>
                  </form>
                )}
                {current.changes.length > 0 && (
                  <details>
                    <summary>정정 이력 {current.changes.length}건</summary>
                    {current.changes.map((change) => (
                      <p key={change.id}>
                        {change.reason}:{" "}
                        {JSON.parse(change.before_json).amount.toLocaleString()}
                        원 →{" "}
                        {JSON.parse(change.after_json).amount.toLocaleString()}
                        원
                      </p>
                    ))}
                  </details>
                )}
                {detail.capabilities.evidence && (
                  <div className="finance-evidence">
                    <button onClick={() => showEvidence(current)}>
                      증빙 목록 보기
                    </button>
                    {!settled && (
                      <label>
                        증빙 추가 (50 MiB 이내){" "}
                        <input
                          type="file"
                          accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,.docx,.xlsx,.pptx,.hwp,.hwpx"
                          disabled={busy}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) uploadEvidence(current, file);
                          }}
                        />
                      </label>
                    )}
                    {evidence.map((item) => (
                      <button key={item.id} onClick={() => download(item)}>
                        {item.filename} 내려받기
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
          {detail.is_admin && !settled && (
            <section className="panel">
              <h2>전체 정산</h2>
              <p className="muted">
                모든 지출의 개별 검토·초과분 처리·증빙 등록 후 선생님이
                확정합니다. 확정 후 원본은 잠깁니다.
              </p>
              <button
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      `${year}년 ${options.organizations.find((o) => o.id === org)?.name} 정산을 확정하시겠습니까?`,
                    )
                  )
                    perform(
                      () =>
                        api("/budgets/settle", {
                          org_id: org,
                          year,
                          expected_revision: detail.budget?.revision,
                        }),
                      "전체 정산을 확정했습니다.",
                    );
                }}
              >
                전체 정산 확정
              </button>
            </section>
          )}
          {detail.settlements.length > 0 && (
            <section className="panel">
              <h2>확정 정산 기록</h2>
              {detail.settlements.map((entry) => (
                <button
                  key={entry.id}
                  onClick={async () => {
                    try {
                      const result = await api<{
                        created_at: string;
                        snapshot: BudgetDetail;
                      }>(`/budgets/history/settlements/${entry.id}`);
                      setSettlement(result);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {entry.created_at} 확정본 보기
                </button>
              ))}
              {settlement && (
                <div className="finance-detail">
                  <strong>{settlement.created_at} 확정본</strong>
                  <p>
                    당시 실제 집행{" "}
                    {won(settlement.snapshot.totals?.actual || 0)} · 잔액{" "}
                    {won(settlement.snapshot.totals?.remaining || 0)}
                  </p>
                  <p className="muted">
                    당시 지출 {settlement.snapshot.expenses.length}건과 검토
                    상태를 보존합니다.
                  </p>
                </div>
              )}
            </section>
          )}
        </>
      )}
      {expenseDraft && (
        <ExpenseDialog
          org={expenseDraft.org}
          year={expenseDraft.year}
          orgName={
            options.organizations.find((o) => o.id === expenseDraft.org)
              ?.name || "단체"
          }
          userId={user.id}
          people={expenseDraft.people}
          events={expenseDraft.detail.events}
          canEvidence={Boolean(expenseDraft.detail.capabilities.evidence)}
          onClose={() => setExpenseDraft(null)}
          onRecorded={refresh}
          onSaved={async (id, hasEvidence) => {
            await refresh();
            setSelected(id);
            setEvidence([]);
            setNotice(
              hasEvidence
                ? "지출과 증빙을 저장했습니다. 사용액과 잔액에 반영했습니다."
                : "실제 지출을 기록했습니다. 사용액과 잔액에 반영했으며 증빙은 나중에 추가할 수 있습니다.",
            );
          }}
        />
      )}
    </div>
  );
}
