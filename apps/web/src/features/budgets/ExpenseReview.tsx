import { useState, type FormEvent } from "react";
import {
  historyLabel,
  paymentMethods,
  resolutionTimestamp,
  reviewStatuses,
  type Resolution,
  type ResolutionHistory,
  type ReviewStatus,
} from "./resolution";

export type Correction = {
  amount: number;
  purpose: string;
  reason: string;
  resolution?: Resolution;
  resubmit: boolean;
};

type ReviewDecision = "approved" | "rejected";

export function ExpenseSummary({
  expense,
  amount,
  historicalEvent,
}: {
  expense: {
    resolution: Resolution | null;
    spent_on: string;
    purpose: string;
    executor_name: string;
    review_state: ReviewStatus;
    history: ResolutionHistory[];
  };
  amount: string;
  historicalEvent?: string;
}) {
  const { resolution, history = [] } = expense;
  const submitted = history.find(
    (item) => item.action === "finance.expense-created",
  );
  const lastReview = [...history]
    .reverse()
    .find((item) => item.action === "finance.expense-reviewed");
  return (
    <header className="finance-resolution-summary">
      <div className="finance-resolution-heading">
        <h3>{resolution?.title || expense.purpose}</h3>
        <strong>{amount}</strong>
      </div>
      <dl>
        <div>
          <dt>집행일</dt>
          <dd>{expense.spent_on}</dd>
        </div>
        <div>
          <dt>실제 집행자</dt>
          <dd>{expense.executor_name}</dd>
        </div>
        {submitted && (
          <div>
            <dt>제출자</dt>
            <dd>{submitted.actor_name}</dd>
          </div>
        )}
        {historicalEvent && (
          <div>
            <dt>기존 행사</dt>
            <dd>{historicalEvent}</dd>
          </div>
        )}
        {resolution?.payee && (
          <div>
            <dt>거래처 / 지급처</dt>
            <dd>{resolution.payee}</dd>
          </div>
        )}
        {resolution?.payment_method && (
          <div>
            <dt>결제 수단</dt>
            <dd>
              {
                paymentMethods[
                  resolution.payment_method as keyof typeof paymentMethods
                ]
              }
            </dd>
          </div>
        )}
        {resolution && (
          <div className="wide">
            <dt>지출 목적</dt>
            <dd>{expense.purpose}</dd>
          </div>
        )}
      </dl>
      {expense.review_state === "rejected" && lastReview?.reason && (
        <div className="finance-return-note">
          <strong>반려 사유</strong>
          <p>{lastReview.reason}</p>
        </div>
      )}
    </header>
  );
}

export function ExpenseHistory({
  history = [],
}: {
  history: ResolutionHistory[];
}) {
  if (!history.length) return null;
  return (
    <details className="finance-resolution-history" open>
      <summary>결의 진행 이력</summary>
      <ol>
        {history.map((item) => (
          <li key={item.id}>
            <div>
              <strong>{historyLabel(item)}</strong> · {item.actor_name}
            </div>
            <time dateTime={item.at}>
              {resolutionTimestamp.format(new Date(item.at))}
            </time>
            {item.reason && <p>{item.reason}</p>}
          </li>
        ))}
      </ol>
    </details>
  );
}

export function ExpenseReviewActions({
  expense,
  busy,
  canReview,
  canCorrect,
  error,
  onReview,
  onCorrect,
}: {
  expense: {
    amount: number;
    purpose: string;
    resolution: Resolution | null;
    review_state: ReviewStatus;
  };
  busy: boolean;
  canReview: boolean;
  canCorrect: boolean;
  error: string;
  onReview: (decision: ReviewDecision, reason: string) => Promise<boolean>;
  onCorrect: (values: Correction) => Promise<boolean>;
}) {
  const [decision, setDecision] = useState<ReviewDecision | null>(null);
  const [correction, setCorrection] = useState(false);
  const resubmit = expense.review_state === "rejected";
  async function submitReview(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!decision || busy) return;
    const reason = String(
      new FormData(e.currentTarget).get("reason") ?? "",
    ).trim();
    if (
      await onReview(
        decision,
        reason ||
          (decision === "approved" ? "지출결의 내용을 확인했습니다." : ""),
      )
    )
      setDecision(null);
  }
  async function submitCorrection(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);
    const title = String(form.get("title") ?? "");
    const saved = await onCorrect({
      amount: Number(form.get("amount")),
      purpose: String(form.get("purpose")),
      reason: String(form.get("reason")),
      resubmit,
      resolution: title
        ? {
            title,
            payee: String(form.get("payee")),
            payment_method: String(form.get("payment_method")),
          }
        : undefined,
    });
    if (saved) setCorrection(false);
  }
  return (
    <section className="finance-resolution-actions" aria-label="결의서 처리">
      {canReview && (
        <div className="finance-actions">
          <button
            type="button"
            className="primary"
            disabled={busy}
            aria-expanded={decision === "approved"}
            onClick={() => {
              setDecision("approved");
              setCorrection(false);
            }}
          >
            승인
          </button>
          <button
            type="button"
            disabled={busy}
            aria-expanded={decision === "rejected"}
            onClick={() => {
              setDecision("rejected");
              setCorrection(false);
            }}
          >
            반려
          </button>
        </div>
      )}
      {decision && canReview && (
        <form
          className="finance-resolution-action-form"
          onSubmit={submitReview}
          key={decision}
        >
          <label>
            {decision === "approved" ? "승인 의견 (선택)" : "반려 사유"}
            <textarea
              name="reason"
              rows={2}
              minLength={2}
              maxLength={500}
              required={decision === "rejected"}
              placeholder={
                decision === "rejected"
                  ? "제출자가 보완할 내용을 적어 주세요."
                  : undefined
              }
            />
          </label>
          <div className="finance-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => setDecision(null)}
            >
              취소
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {reviewStatuses[decision]} 확정
            </button>
          </div>
        </form>
      )}
      {canCorrect && (
        <button
          type="button"
          disabled={busy}
          aria-expanded={correction}
          onClick={() => {
            setCorrection(!correction);
            setDecision(null);
          }}
        >
          {resubmit ? "보완 후 재제출" : "지출 내용 정정"}
        </button>
      )}
      {canCorrect && correction && (
        <form
          className="finance-resolution-action-form"
          onSubmit={submitCorrection}
        >
          <div className="finance-resolution-correction-fields">
            <label className="wide">
              결의서 제목
              <input
                name="title"
                maxLength={120}
                required
                defaultValue={
                  expense.resolution?.title ?? expense.purpose.slice(0, 120)
                }
              />
            </label>
            <label className="wide">
              지출 목적
              <textarea
                name="purpose"
                rows={2}
                maxLength={300}
                required
                defaultValue={expense.purpose}
              />
            </label>
            <label>
              현재 반영 금액 (원)
              <input
                name="amount"
                type="number"
                min="0"
                max={10 ** 15}
                required
                defaultValue={expense.amount}
              />
            </label>
            <label>
              거래처 / 지급처
              <input
                name="payee"
                maxLength={120}
                defaultValue={expense.resolution?.payee}
              />
            </label>
            <label>
              결제 수단
              <select
                name="payment_method"
                defaultValue={expense.resolution?.payment_method ?? ""}
              >
                <option value="">선택</option>
                {Object.entries(paymentMethods).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="wide">
              {resubmit ? "보완한 내용" : "정정 사유"}
              <textarea
                name="reason"
                rows={2}
                minLength={2}
                maxLength={500}
                required
              />
            </label>
          </div>
          <div className="finance-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => setCorrection(false)}
            >
              취소
            </button>
            <button type="submit" disabled={busy} className="primary">
              {resubmit ? "재제출" : "정정 기록"}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
