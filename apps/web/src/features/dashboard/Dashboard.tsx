import {
  formatDate as shortDate,
  lastIncludedInstant,
} from "../../shared/tenure";
import type { Assignment, Person, Workspace } from "../../shared/api";

type Props = { workspace: Workspace; user: Person; onManage: () => void };
function monthKey(value: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(value));
  return `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}`;
}
function ScheduleChart({ rows, time }: { rows: Assignment[]; time: string }) {
  const key = monthKey(time),
    [year, month] = key.split("-").map(Number),
    now = Date.parse(time);
  const months = Array.from({ length: 6 }, (_, i) => {
    const date = new Date(Date.UTC(year, month - 1 + i, 1));
    return {
      key: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
      label: `${date.getUTCMonth() + 1}월`,
      starts: 0,
      ends: 0,
    };
  });
  for (const row of rows) {
    if (row.revoked_at) continue;
    for (const item of months) {
      if (
        Date.parse(row.starts_at) > now &&
        monthKey(row.starts_at) === item.key
      )
        item.starts++;
      if (
        Date.parse(row.ends_at) > now &&
        monthKey(lastIncludedInstant(row.ends_at)) === item.key
      )
        item.ends++;
    }
  }
  const max = Math.max(2, ...months.flatMap((m) => [m.starts, m.ends]));
  const x = (i: number) => 50 + i * 110,
    y = (n: number) => 164 - (n / max) * 125;
  const caption = months
    .map((m) => `${m.label} 시작 ${m.starts}건, 종료 ${m.ends}건`)
    .join("; ");
  return (
    <section
      className="dashboard-card schedule-card"
      aria-labelledby="schedule-title"
    >
      <div className="dashboard-card-heading">
        <div>
          <h2 id="schedule-title">역할 임기 일정</h2>
          <p>등록된 임기 기준 · 향후 6개월</p>
        </div>
        <span className="chart-period">
          {months[0].key.replace("-", ".")} — {months[5].key.replace("-", ".")}
        </span>
      </div>
      <svg
        className="schedule-chart"
        viewBox="0 0 650 200"
        role="img"
        aria-label={caption}
      >
        {[0, Math.ceil(max / 2), max].map((n) => (
          <g key={n}>
            <line x1="50" y1={y(n)} x2="600" y2={y(n)} className="chart-grid" />
            <text x="30" y={y(n) + 4} textAnchor="end" className="chart-label">
              {n}
            </text>
          </g>
        ))}
        <polyline
          points={months.map((m, i) => `${x(i)},${y(m.starts)}`).join(" ")}
          className="chart-line starts"
        />
        <polyline
          points={months.map((m, i) => `${x(i)},${y(m.ends)}`).join(" ")}
          className="chart-line ends"
        />
        {months.map((m, i) => (
          <g key={m.key}>
            <circle cx={x(i)} cy={y(m.ends)} r="3" className="chart-point">
              <title>
                {m.key}: 시작 {m.starts}건, 종료 {m.ends}건
              </title>
            </circle>
            <text x={x(i)} y="190" textAnchor="middle" className="chart-label">
              {m.label}
            </text>
          </g>
        ))}
      </svg>
      <div className="chart-legend">
        <span>
          <i className="legend-line starts" />
          임기 시작
        </span>
        <span>
          <i className="legend-line ends" />
          임기 종료
        </span>
        <small>역할 건수 기준</small>
      </div>
    </section>
  );
}
function StatusChart({ rows, time }: { rows: Assignment[]; time: string }) {
  const now = Date.parse(time),
    active = rows.filter((r) => r.effective).length;
  const future = rows.filter(
    (r) => !r.revoked_at && !r.effective && Date.parse(r.starts_at) > now,
  ).length;
  const segments = [
    { label: "유효", count: active, color: "#6B625B" },
    { label: "시작 대기", count: future, color: "#F7F3EE" },
    { label: "비활성", count: rows.length - active - future, color: "#1F1D1B" },
  ];
  const circumference = 2 * Math.PI * 46;
  let offset = 0;
  return (
    <section
      className="dashboard-card status-card"
      aria-labelledby="status-title"
    >
      <div className="dashboard-card-heading">
        <h2 id="status-title">역할 상태</h2>
        <span className="chart-period">현재 기준</span>
      </div>
      <div className="donut-wrap">
        <svg
          viewBox="0 0 180 160"
          role="img"
          aria-label={segments.map((s) => `${s.label} ${s.count}개`).join(", ")}
        >
          <circle
            cx="90"
            cy="77"
            r="46"
            fill="none"
            stroke="#E6DED4"
            strokeWidth="19"
          />
          {segments.map((s) => {
            const length = rows.length
              ? (s.count / rows.length) * circumference
              : 0;
            const current = offset;
            offset += length;
            return s.count > 0 ? (
              <circle
                key={s.label}
                cx="90"
                cy="77"
                r="46"
                fill="none"
                stroke={s.color}
                strokeWidth="19"
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-current}
                transform="rotate(-90 90 77)"
              />
            ) : null;
          })}
          <text x="90" y="77" textAnchor="middle" className="donut-number">
            {rows.length}
          </text>
          <text x="90" y="96" textAnchor="middle" className="donut-caption">
            등록 역할
          </text>
        </svg>
      </div>
      <div className="status-legend">
        {segments.map((s) => (
          <span key={s.label}>
            <i style={{ background: s.color }} />
            {s.label}
            <strong>{s.count}</strong>
          </span>
        ))}
      </div>
    </section>
  );
}
export default function Dashboard({ workspace, user, onManage }: Props) {
  const own = workspace.assignments.filter(
    (a) => a.user_id === user.id && a.effective,
  );
  const active = workspace.assignments.filter((a) => a.effective).length;
  const waiting = workspace.assignments.filter(
    (a) =>
      !a.revoked_at &&
      !a.effective &&
      Date.parse(a.starts_at) > Date.parse(workspace.server_time),
  ).length;
  const unitPath = (id: string): string => {
    const u = workspace.units.find((u) => u.id === id);
    return u
      ? u.parent_id
        ? `${unitPath(u.parent_id)} / ${u.name}`
        : u.name
      : id;
  };
  return (
    <div className="reference-dashboard">
      <div className="dashboard-tools">
        <span>
          {user.is_admin ? "전체 조직" : "내 조회 범위"}의 담당자와 역할
          현황입니다.
        </span>
        <button onClick={onManage}>담당자 관리하기 ↗</button>
      </div>
      <div className="dashboard-charts">
        <ScheduleChart
          rows={workspace.assignments}
          time={workspace.server_time}
        />
        <StatusChart
          rows={workspace.assignments}
          time={workspace.server_time}
        />
      </div>
      <section className="dashboard-summary" aria-label="담당 범위 요약">
        <article>
          <div>
            <span>조회 가능한 담당자</span>
            <strong>
              {workspace.users.length}
              <small>명</small>
            </strong>
          </div>
          <div>
            <span>등록 역할</span>
            <strong>
              {workspace.assignments.length}
              <small>개</small>
            </strong>
          </div>
        </article>
        <article>
          <div>
            <span>유효 역할</span>
            <strong>
              {active}
              <small>개</small>
            </strong>
          </div>
          <div>
            <span>시작 대기</span>
            <strong>
              {waiting}
              <small>개</small>
            </strong>
          </div>
        </article>
        <article>
          <div>
            <span>나의 유효 역할</span>
            <strong>
              {own.length}
              <small>개</small>
            </strong>
          </div>
          <div>
            <span>역할 관리</span>
            <strong className="summary-text">
              {workspace.grant_options.length ? "가능" : "조회 전용"}
            </strong>
          </div>
        </article>
      </section>
      <div className="dashboard-tables">
        <section className="dashboard-card">
          <div className="dashboard-card-heading">
            <h2>내 담당 범위</h2>
            <span className="table-count">
              {own.length}
              {user.is_admin ? " + 관리자" : ""}
            </span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>역할</th>
                  <th>담당 소속</th>
                  <th>임기 종료</th>
                </tr>
              </thead>
              <tbody>
                {Boolean(user.is_admin) && (
                  <tr>
                    <td>
                      <strong>서비스 관리자</strong>
                    </td>
                    <td>학생성공센터</td>
                    <td>별도 관리</td>
                  </tr>
                )}
                {own.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.role_label || workspace.roles[a.role]}</strong>
                    </td>
                    <td>{unitPath(a.unit_id)}</td>
                    <td>{shortDate(lastIncludedInstant(a.ends_at))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {own.some((a) => a.role === "chair") && (
            <p className="table-note">
              학회장들의 투표로 선출 · 자기 학과 학회장과 동일 임기
            </p>
          )}
          {!own.length && !user.is_admin && (
            <p className="dashboard-empty">
              현재 유효한 업무 역할이 없습니다. 담당 책임자에게 역할 등록을
              요청해 주세요.
            </p>
          )}
        </section>
        <section className="dashboard-card">
          <div className="dashboard-card-heading">
            <h2>최고 책임자 연락처</h2>
            <span className="table-count">{workspace.contacts.length}명</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>담당자</th>
                  <th>단체</th>
                  <th>연락처</th>
                </tr>
              </thead>
              <tbody>
                {workspace.contacts.map((c) => (
                  <tr key={`${c.id}-${c.org_id}`}>
                    <td>
                      <strong>{c.name}</strong>
                    </td>
                    <td>{c.org_name}</td>
                    <td>
                      <a className="contact-email" href={`mailto:${c.email}`}>
                        {c.email}
                      </a>
                      <small>{c.phone}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!workspace.contacts.length && (
            <p className="dashboard-empty">등록된 최고 책임자가 없습니다.</p>
          )}
          <p className="table-note">
            일반 담당자의 전체 연락처는 공개하지 않습니다.
          </p>
        </section>
      </div>
    </div>
  );
}
