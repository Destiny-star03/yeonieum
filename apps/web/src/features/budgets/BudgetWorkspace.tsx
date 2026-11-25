import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { api } from "../../shared/api";
import "./budgets.css";
import BudgetBalance from "./BudgetBalance";
import ExpenseDialog from "./ExpenseDialog";
import {
  ExpenseHistory,
  ExpenseReviewActions,
  ExpenseSummary,
  type Correction,
} from "./ExpenseReview";
import OrganizationCards, { useOrganizationOrder } from "./OrganizationCards";
import ReceiptPreview from "./ReceiptPreview";
import {
  reviewStatuses,
  type Resolution,
  type ResolutionHistory,
  type ReviewStatus,
} from "./resolution";

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
  review_state: ReviewStatus;
  resolution: Resolution | null;
  history: ResolutionHistory[];
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
type Evidence = {
  id: string;
  filename: string;
  size: number;
  previewable: boolean;
};
const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const labels: Record<string, string> = {
  view: "회계 내역 열람",
  plan: "예산 편성",
  record: "지출 기록·정정",
  review: "개별 지출 검토",
  evidence: "민감 증빙 열람·등록",
};

function writeExpenseSelection(org: string, year: number, id: string) {
  const url = new URL(window.location.href);
  for (const [key, value] of [
    ["budgetOrg", org],
    ["budgetYear", String(year)],
    ["expense", id],
  ]) {
    if (id) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  if (url.href !== window.location.href)
    window.history.replaceState(window.history.state, "", url);
}

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
  const [initialSelection] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const org = params.get("budgetOrg") || "";
    const year = Number(params.get("budgetYear"));
    return org && Number.isInteger(year) && year >= 2000 && year <= 2200
      ? { org, year, id: params.get("expense") || "" }
      : { org: "", year: new Date().getFullYear(), id: "" };
  });
  const [org, setOrg] = useState(initialSelection.org);
  const organizationOrder = useOrganizationOrder(user.id);
  const [year, setYear] = useState(initialSelection.year);
  const [detail, setDetail] = useState<BudgetDetail | null>(null);
  const [selected, setSelected] = useState(initialSelection.id);
  const [statusFilter, setStatusFilter] = useState<ReviewStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [resolutionError, setResolutionError] = useState("");
  const [settlement, setSettlement] = useState<{
    created_at: string;
    snapshot: BudgetDetail;
  } | null>(null);
  const [evidence, setEvidence] = useState<{
    expenseId: string;
    items: Evidence[];
    error?: string;
  } | null>(null);
  const [evidenceRetry, setEvidenceRetry] = useState(0);
  const [previewEvidence, setPreviewEvidence] = useState("");
  const [evidenceActionError, setEvidenceActionError] = useState("");
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
  const expenseDetail = useRef<HTMLDivElement>(null);
  const focusExpense = useRef(false);

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
    if (chosen !== org) {
      setOrg(chosen);
      setDetail(null);
      setSelected("");
      writeExpenseSelection(chosen, year, "");
      return;
    }
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

  const current = detail?.expenses.find((item) => item.id === selected);
  const selectedExpenseId = current?.id;
  const evidenceCount = current?.evidence_count;
  const canReadEvidence = Boolean(detail?.capabilities.evidence);
  const currentEvidence =
    evidence?.expenseId === selectedExpenseId ? evidence : null;
  useEffect(() => {
    if (!selectedExpenseId || !canReadEvidence) return;
    let active = true;
    setEvidence(null);
    api<Evidence[]>(`/budgets/expenses/${selectedExpenseId}/evidence`)
      .then((items) => {
        if (active) setEvidence({ expenseId: selectedExpenseId, items });
      })
      .catch((e: Error) => {
        if (active)
          setEvidence({
            expenseId: selectedExpenseId,
            items: [],
            error: e.message,
          });
      });
    return () => {
      active = false;
    };
  }, [selectedExpenseId, canReadEvidence, evidenceCount, evidenceRetry]);
  useEffect(() => {
    if (!expenseDraft && selectedExpenseId && focusExpense.current) {
      focusExpense.current = false;
      expenseDetail.current?.focus();
    }
  }, [expenseDraft, selectedExpenseId]);

  function selectExpense(id: string) {
    setSelected(id);
    setEvidence(null);
    setPreviewEvidence("");
    setEvidenceActionError("");
    setResolutionError("");
    writeExpenseSelection(org, year, id);
  }

  function changeBudget(nextOrg: string, nextYear: number) {
    if (busy || (nextOrg === org && nextYear === year)) return;
    setOrg(nextOrg);
    setYear(nextYear);
    selectExpense("");
    setSettlement(null);
    setDetail(null);
    setStatusFilter("all");
    setSearch("");
  }

  async function perform(
    action: () => Promise<unknown>,
    success: string,
    onFailure = setError,
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await refresh();
      setNotice(success);
      return true;
    } catch (e) {
      onFailure((e as Error).message);
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
  async function submitCorrection(row: Expense, correction: Correction) {
    setResolutionError("");
    const saved = await perform(
      () =>
        api(`/budgets/expenses/${row.id}/correct`, {
          ...correction,
          expected_revision: row.revision,
        }),
      correction.resubmit
        ? "보완한 결의서를 다시 제출했습니다."
        : "정정 이력을 남겼습니다. 검토가 다시 필요합니다.",
      setResolutionError,
    );
    if (saved) {
      setStatusFilter("all");
      setSearch("");
    }
    return saved;
  }
  async function reviewExpense(row: Expense, decision: string, reason: string) {
    setResolutionError("");
    const saved = await perform(
      () =>
        api(`/budgets/expenses/${row.id}/review`, {
          decision,
          reason,
          expected_revision: row.revision,
        }),
      decision === "approved"
        ? "결의서를 승인했습니다."
        : "결의서를 반려했습니다.",
      setResolutionError,
    );
    if (saved) setStatusFilter("all");
    return saved;
  }
  async function handleException(row: Expense, answer: string) {
    const reason = window.prompt(
      answer === "approved"
        ? "확인 사유를 입력해 주세요."
        : "반려 사유를 입력해 주세요.",
    );
    if (!reason || reason.trim().length < 2) return;
    await perform(
      () =>
        api(`/budgets/expenses/${row.id}/exception`, {
          decision: answer,
          reason,
          expected_revision: row.revision,
        }),
      "처리 결과와 사유를 기록했습니다.",
    );
  }
  async function uploadEvidence(row: Expense, file: File) {
    setEvidenceActionError("");
    await perform(
      async () => {
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
          const body = await response.json().catch(() => null);
          throw new Error(
            typeof body?.detail === "string"
              ? body.detail
              : "증빙 등록에 실패했습니다.",
          );
        }
      },
      "증빙을 안전하게 등록했습니다.",
      setEvidenceActionError,
    );
  }
  async function download(item: Evidence) {
    setEvidenceActionError("");
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
      setEvidenceActionError((e as Error).message);
    }
  }
  const people = [...(options.people[org] || [])];
  if (user.is_admin && !people.some((p) => p.id === user.id))
    people.push({ id: user.id, name: user.name });
  const settled = Boolean(detail?.budget?.settled_at);
  const orgName = options.organizations.find((item) => item.id === org)?.name;
  const canRecord = Boolean(
    detail?.budget && detail.capabilities.record && !settled,
  );
  const expenses = detail?.expenses ?? [];
  const filters = [
    { id: "all" as const, label: "전체", count: expenses.length },
    ...(Object.keys(reviewStatuses) as ReviewStatus[]).map((id) => ({
      id,
      label: reviewStatuses[id],
      count: expenses.filter((row) => row.review_state === id).length,
    })),
  ];
  const query = search.trim().toLocaleLowerCase("ko-KR");
  const visibleExpenses = expenses.filter(
    (row) =>
      (statusFilter === "all" || row.review_state === statusFilter) &&
      [
        row.resolution?.title,
        row.purpose,
        row.executor_name,
        row.resolution?.payee,
      ].some((value) => value?.toLocaleLowerCase("ko-KR").includes(query)),
  );
  return (
    <div className="finance-page">
      <section className="panel finance-overview-panel">
        <div className="finance-overview-heading">
          <div>
            <h2>예산 현황</h2>
            {orgName && (
              <p>
                {year}년 · {orgName}
              </p>
            )}
          </div>
          {detail && canRecord && (
            <button
              type="button"
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
              ＋ 지출결의서 작성
            </button>
          )}
        </div>
        <div className="finance-controls">
          <label>
            단체{" "}
            <select
              value={org}
              onChange={(e) => changeBudget(e.target.value, year)}
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
              onChange={(e) => changeBudget(org, Number(e.target.value))}
            />
          </label>
        </div>
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
        {detail?.budget && detail.totals && (
          <BudgetBalance
            key={`balance-${org}-${year}`}
            totals={detail.totals}
            expenses={detail.expenses}
          />
        )}
        {detail && !detail.budget && (
          <p className="finance-unconfigured">
            이 단체의 연간 예산이 아직 설정되지 않았습니다.
          </p>
        )}
        {settled && (
          <p className="success">정산 확정 · {detail?.budget?.settled_at}</p>
        )}
        {detail?.capabilities.plan && !settled && (
          <details
            className="finance-budget-settings"
            key={`settings-${org}-${year}`}
            open={!detail.budget}
          >
            <summary>
              {detail.budget ? "연간 예산 수정" : "연간 예산 설정"}
            </summary>
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
          </details>
        )}
        {overview.length > 1 && (
          <section
            className="finance-organization-overview"
            aria-label="단체별 예산 비교"
          >
            <h3>단체별 예산</h3>
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
              onSelect={(id) => changeBudget(id, year)}
              onMove={organizationOrder.move}
              message={organizationOrder.message}
            />
          </section>
        )}
      </section>
      {detail?.budget && (
        <>
          <section className="panel finance-ledger">
            <h2>지출결의서</h2>
            {expenses.length > 0 && (
              <div className="finance-ledger-tools">
                <div
                  className="finance-ledger-filters"
                  role="group"
                  aria-label="결의서 상태"
                >
                  {filters.map(({ id, label, count }) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={statusFilter === id}
                      onClick={() => setStatusFilter(id)}
                    >
                      {label} <span>{count}</span>
                    </button>
                  ))}
                </div>
                <input
                  type="search"
                  aria-label="결의서 검색"
                  placeholder="제목, 집행자, 거래처 검색"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            )}
            {visibleExpenses.length === 0 && (
              <p className="finance-resolution-empty" role="status">
                {expenses.length
                  ? "조건에 맞는 결의서가 없습니다."
                  : "제출한 지출결의서가 없습니다."}
              </p>
            )}
            <div className="finance-list">
              {visibleExpenses.map((row) => (
                <div
                  key={row.id}
                  className={row.id === selected ? "is-selected" : undefined}
                >
                  <button
                    className="finance-row"
                    aria-expanded={row.id === selected}
                    aria-controls={
                      row.id === selected ? "finance-expense-detail" : undefined
                    }
                    onClick={() =>
                      selectExpense(row.id === selected ? "" : row.id)
                    }
                  >
                    <span className="finance-row-heading">
                      <strong>{row.resolution?.title || row.purpose}</strong>
                      <b>{won(row.amount)}</b>
                    </span>
                    <span className="finance-row-meta">
                      {row.spent_on} · {row.executor_name} 집행
                    </span>
                    <span className="finance-row-status">
                      <span data-review={row.review_state}>
                        {reviewStatuses[row.review_state]}
                      </span>
                      {row.exception_state !== "none" && (
                        <span>{`초과 ${row.exception_state === "pending" ? "확인 대기" : row.exception_state === "approved" ? "확인" : "반려"}`}</span>
                      )}
                      <span>
                        {row.evidence_count > 0
                          ? `증빙 ${row.evidence_count}개`
                          : "첨부 없음"}
                      </span>
                    </span>
                    <small className="finance-balance-change">
                      {won(row.balance_before)} − {won(row.amount)} = 잔액{" "}
                      {won(row.balance_after)}
                    </small>
                  </button>
                  {current && current.id === row.id && (
                    <div
                      className="finance-detail"
                      id="finance-expense-detail"
                      ref={expenseDetail}
                      tabIndex={-1}
                    >
                      <ExpenseSummary
                        expense={current}
                        amount={won(current.amount)}
                        historicalEvent={
                          detail.events.find(
                            (event) => event.id === current.event_id,
                          )?.name
                        }
                      />
                      {current.exception_state === "pending" &&
                        !settled &&
                        ((current.exception_requires_teacher &&
                          detail.is_admin) ||
                          (!current.exception_requires_teacher &&
                            detail.is_head &&
                            user.id !== current.executor_id)) && (
                          <div className="finance-actions">
                            <button
                              disabled={busy}
                              onClick={() =>
                                handleException(current, "approved")
                              }
                            >
                              초과분 확인
                            </button>
                            <button
                              disabled={busy}
                              onClick={() =>
                                handleException(current, "rejected")
                              }
                            >
                              초과분 반려
                            </button>
                          </div>
                        )}
                      {current.changes.length > 0 && (
                        <details>
                          <summary>
                            정정 이력 {current.changes.length}건
                          </summary>
                          {current.changes.map((change) => (
                            <p key={change.id}>
                              {change.reason}:{" "}
                              {JSON.parse(
                                change.before_json,
                              ).amount.toLocaleString()}
                              원 →{" "}
                              {JSON.parse(
                                change.after_json,
                              ).amount.toLocaleString()}
                              원
                            </p>
                          ))}
                        </details>
                      )}
                      {canReadEvidence && (
                        <section
                          className="finance-evidence"
                          aria-labelledby="finance-evidence-title"
                        >
                          <h4 id="finance-evidence-title">첨부 증빙</h4>
                          {evidenceActionError && (
                            <p
                              role="alert"
                              className="error finance-receipt-error"
                            >
                              {evidenceActionError}
                            </p>
                          )}
                          {!currentEvidence ? (
                            <p className="finance-input-note" role="status">
                              첨부 증빙을 불러오는 중…
                            </p>
                          ) : currentEvidence.error ? (
                            <div className="finance-evidence-actions">
                              <p
                                role="alert"
                                className="error finance-receipt-error"
                              >
                                {currentEvidence.error}
                              </p>
                              <button
                                onClick={() =>
                                  setEvidenceRetry((count) => count + 1)
                                }
                              >
                                첨부 증빙 다시 불러오기
                              </button>
                            </div>
                          ) : currentEvidence.items.length === 0 ? (
                            <p className="finance-input-note">첨부 없음</p>
                          ) : (
                            <ul className="finance-evidence-list">
                              {currentEvidence.items.map((item) => (
                                <li key={item.id}>
                                  <div className="finance-evidence-actions">
                                    <strong>{item.filename}</strong>
                                    {item.previewable && (
                                      <button
                                        type="button"
                                        aria-expanded={
                                          previewEvidence === item.id
                                        }
                                        aria-label={`${item.filename} ${previewEvidence === item.id ? "미리보기 닫기" : "미리보기"}`}
                                        onClick={() =>
                                          setPreviewEvidence(
                                            previewEvidence === item.id
                                              ? ""
                                              : item.id,
                                          )
                                        }
                                      >
                                        {previewEvidence === item.id
                                          ? "미리보기 닫기"
                                          : "미리보기"}
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      aria-label={`${item.filename} 내려받기`}
                                      onClick={() => download(item)}
                                    >
                                      내려받기
                                    </button>
                                  </div>
                                  {previewEvidence === item.id && (
                                    <ReceiptPreview
                                      filename={item.filename}
                                      evidenceId={item.id}
                                    />
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                          {!settled && (
                            <label>
                              증빙 추가 (50 MiB 이내){" "}
                              <input
                                type="file"
                                accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,.docx,.xlsx,.pptx,.hwp,.hwpx"
                                disabled={busy}
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) {
                                    void uploadEvidence(current, file);
                                    e.target.value = "";
                                  }
                                }}
                              />
                            </label>
                          )}
                        </section>
                      )}
                      {!settled &&
                        (detail.capabilities.review ||
                          detail.capabilities.record) && (
                          <ExpenseReviewActions
                            key={current.id}
                            expense={current}
                            busy={busy}
                            canReview={Boolean(
                              detail.capabilities.review &&
                              current.review_state === "pending",
                            )}
                            canCorrect={Boolean(detail.capabilities.record)}
                            error={resolutionError}
                            onReview={(decision, reason) =>
                              reviewExpense(current, decision, reason)
                            }
                            onCorrect={(correction) =>
                              submitCorrection(current, correction)
                            }
                          />
                        )}
                      <ExpenseHistory history={current.history} />
                    </div>
                  )}
                </div>
              ))}
            </div>
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
          remaining={expenseDraft.detail.totals?.remaining ?? 0}
          canEvidence={Boolean(expenseDraft.detail.capabilities.evidence)}
          onClose={() => setExpenseDraft(null)}
          onSaved={async (id, hasEvidence) => {
            writeExpenseSelection(expenseDraft.org, expenseDraft.year, id);
            await refresh();
            focusExpense.current = true;
            setStatusFilter("all");
            setSearch("");
            selectExpense(id);
            setNotice(
              hasEvidence
                ? "결의서와 증빙을 제출했습니다. 지출액을 잔액에 반영했습니다."
                : "결의서를 제출했습니다. 지출액을 잔액에 반영했고 증빙은 상세에서 추가할 수 있습니다.",
            );
          }}
        />
      )}
    </div>
  );
}
