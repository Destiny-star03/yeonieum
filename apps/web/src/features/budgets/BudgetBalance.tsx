import { useState } from "react";

type BalanceTotals = {
  budget: number;
  actual: number;
  remaining: number;
  excess: number;
};

type ExpenseBalance = { spent_on: string; balance_after: number };

const won = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;

export default function BudgetBalance({
  totals,
  expenses,
}: {
  totals: BalanceTotals;
  expenses: ExpenseBalance[];
}) {
  const [selectedDate, setSelectedDate] = useState("");
  // Expenses arrive in descending spend-date order, with the last posting first within each date.
  const balances = new Map<string, number>();
  for (const expense of expenses) {
    if (!balances.has(expense.spent_on))
      balances.set(expense.spent_on, expense.balance_after);
    if (balances.size === 7) break;
  }
  const points = [...balances].reverse();
  const activePoint =
    points.find(([date]) => date === selectedDate) ?? points.at(-1);
  const values = points.map(([, value]) => value);
  const high = Math.max(1, totals.budget, ...values);
  const low = Math.min(0, ...values);
  const range = high - low;
  const zero = (high / range) * 100;
  const segments = [
    {
      label: "집행액",
      value: Math.min(totals.actual, totals.budget),
      tone: "used",
    },
    { label: "잔액", value: Math.max(0, totals.remaining), tone: "available" },
    { label: "초과액", value: totals.excess, tone: "over" },
  ];

  return (
    <div className="finance-balance-grid">
      <section
        className="finance-balance-card"
        aria-labelledby="finance-balance-title"
      >
        <h3 id="finance-balance-title">현재 잔액</h3>
        <strong
          className={totals.excess > 0 ? "finance-balance-negative" : undefined}
          data-testid="finance-current-balance"
        >
          {won(totals.remaining)}
        </strong>
        {totals.excess > 0 && (
          <span className="finance-over-limit">
            예산 초과 {won(totals.excess)}
          </span>
        )}
        <div
          className="finance-budget-bar"
          role="img"
          aria-label={`연간 예산 ${won(totals.budget)}, 실제 집행 ${won(totals.actual)}, 잔액 ${won(totals.remaining)}`}
        >
          {segments.map(({ label, value, tone }) => (
            <span
              key={label}
              className={`finance-segment-${tone}`}
              style={{ flex: value }}
            />
          ))}
        </div>
        <dl className="finance-balance-amounts">
          <div>
            <dt>연간 예산</dt>
            <dd>{won(totals.budget)}</dd>
          </div>
          <div>
            <dt>
              <i className="finance-segment-used" />
              실제 집행
            </dt>
            <dd>{won(totals.actual)}</dd>
          </div>
        </dl>
      </section>
      <section
        className="finance-balance-trend"
        aria-labelledby="finance-trend-title"
      >
        <h3 id="finance-trend-title">지출일별 잔액</h3>
        {activePoint ? (
          <>
            <p className="finance-trend-value" aria-live="polite">
              {activePoint[0].slice(5).replace("-", ".")} 잔액{" "}
              <strong>{won(activePoint[1])}</strong>
            </p>
            <div className="finance-trend-chart">
              <div className="finance-trend-zero" style={{ top: `${zero}%` }}>
                <span>0원</span>
              </div>
              <ol>
                {points.map(([date, balance]) => {
                  const [, month, day] = date.split("-");
                  const label = `${Number(month)}.${Number(day)}`;
                  return (
                    <li key={date}>
                      <button
                        type="button"
                        aria-label={`${date} 잔액 ${won(balance)}`}
                        aria-pressed={activePoint[0] === date}
                        title={`${date} · ${won(balance)}`}
                        onClick={() => setSelectedDate(date)}
                      >
                        <span
                          className={`finance-trend-column ${balance < 0 ? "finance-trend-negative" : ""}`}
                          style={{
                            top: `${((high - Math.max(0, balance)) / range) * 100}%`,
                            height: `${(Math.abs(balance) / range) * 100}%`,
                          }}
                        />
                        <span className="finance-trend-date">{label}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          </>
        ) : (
          <p className="finance-trend-empty">
            지출을 기록하면 날짜별 잔액을 볼 수 있습니다.
          </p>
        )}
      </section>
    </div>
  );
}
