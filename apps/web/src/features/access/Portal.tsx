import AcademicGroups from "./AcademicGroups";
import AcademicChairControls from "./AcademicChairControls";
import ChairDesignationDialog from "./ChairDesignationDialog";
import {
  formatDate as date,
  seoulYear,
  inclusiveEndInstant,
  lastIncludedInstant,
} from "../../shared/tenure";
import StructureManagement from "./StructureManagement";
import InvitationOutbox from "./InvitationOutbox";
import OrganizationManagement from "../organizations/OrganizationManagement";
import RemovePersonDialog from "./RemovePersonDialog";
import { formatPhone } from "./phone";
import Dashboard from "../dashboard/Dashboard";
import Brand from "../../shared/Brand";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  api,
  type Assignment,
  type Person,
  type Workspace,
} from "../../shared/api";

type Audit = {
  id: string;
  actor_id: string;
  action: string;
  target_id: string;
  org_id: string;
  at: string;
  detail: Record<string, unknown>;
};
const labels: Record<string, string> = {
  "role.granted": "역할 부여",
  "role.revoked": "역할 회수",
  "role.dependency-ended": "연결 자격 종료",
  "user.registered": "담당자 등록",
  "user.removed": "담당자 제거",
  "user.restored": "담당자 복구",
  "invitation.accepted": "초대 인증 완료(로컬)",
  "invitation.reissued": "초대 재발급(로컬)",
  "organization.created": "단체 추가",
  "organization.removed": "단체 삭제",
  "organization.restored": "단체 복원",
  "unit.created": "하위 조직 등록",
  "role_type.created": "역할 종류 추가",
  "role_type.removed": "역할 종류 삭제",
  "role_type.restored": "역할 종류 복원",
};
export default function Portal() {
  const [direct, setDirect] = useState(false);
  const [user, setUser] = useState<Person | null>(null),
    [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [tab, setTab] = useState("overview"),
    [search, setSearch] = useState(""),
    [role, setRole] = useState("");
  const [scopeId, setScopeId] = useState("");
  const [grantOrgId, setGrantOrgId] = useState("");
  const [history, setHistory] = useState<Audit[]>([]),
    [busy, setBusy] = useState(false),
    [revokeRow, setRevokeRow] = useState<Assignment | null>(null);
  const [removePerson, setRemovePerson] = useState<Person | null>(null);
  const [chairCandidate, setChairCandidate] = useState<Assignment | null>(null);
  const [recipientId, setRecipientId] = useState("");
  const [grantFeedback, setGrantFeedback] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const registration = useRef<HTMLDialogElement>(null),
    revocation = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!workspace) return;
    if (
      scopeId &&
      !workspace.grant_options.some((o) => o.unit_id === scopeId)
    ) {
      setScopeId("");
      setRole("");
      setRecipientId("");
    } else if (
      role &&
      !workspace.grant_options.some(
        (o) => o.unit_id === scopeId && o.role === role,
      )
    ) {
      setRole("");
      setRecipientId("");
    }
    if (
      grantOrgId &&
      !workspace.units.some((u) => u.id === grantOrgId && u.active)
    ) {
      setGrantOrgId("");
      setScopeId("");
      setRole("");
    }
  }, [workspace, scopeId, role, grantOrgId]);
  async function refresh() {
    setWorkspace(await api<Workspace>("/workspace"));
  }
  useEffect(() => {
    let alive = true;
    api<Person>("/me")
      .then(async (value) => {
        const data = await api<Workspace>("/workspace");
        if (alive) {
          setUser(value);
          setWorkspace(data);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  function path(id: string): string {
    const item = workspace?.units.find((u) => u.id === id);
    return item
      ? item.parent_id
        ? `${path(item.parent_id)} / ${item.name}`
        : item.active
          ? item.name
          : `${item.name} (삭제됨)`
      : id;
  }
  async function perform(
    action: () => Promise<unknown>,
    success: string | (() => string),
    feedback?: (message: string, error: boolean) => void,
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await refresh();
      const message = typeof success === "function" ? success() : success;
      if (feedback) feedback(message, false);
      else setNotice(message);
    } catch (e) {
      if (feedback) feedback((e as Error).message, true);
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setError("");
    setBusy(true);
    try {
      const value = await api<Person>("/auth/login", Object.fromEntries(data));
      const work = await api<Workspace>("/workspace");
      setUser(value);
      setWorkspace(work);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      await api("/auth/logout", {});
      setUser(null);
      setWorkspace(null);
      setHistory([]);
      setError("");
      setNotice("");
      setTab("overview");
      setDirect(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function activity() {
    setTab("activity");
    setError("");
    try {
      setHistory(await api<Audit[]>("/audit"));
    } catch (e) {
      setHistory([]);
      setError((e as Error).message);
    }
  }
  async function grant(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setGrantFeedback(null);
    const parent = workspace?.assignments.find(
      (a) => a.id === data.get("prerequisite_id"),
    );
    await perform(
      () =>
        api("/assignments", {
          user_id: data.get("user_id"),
          unit_id: data.get("unit_id"),
          role: data.get("role"),
          starts_at:
            role === "chair"
              ? parent?.starts_at
              : new Date(
                  `${data.get("starts_at")}T00:00:00+09:00`,
                ).toISOString(),
          ends_at:
            role === "chair"
              ? parent?.ends_at
              : inclusiveEndInstant(String(data.get("ends_at"))),
          prerequisite_id:
            role === "chair" ? data.get("prerequisite_id") : null,
          election_note: role === "chair" ? data.get("election_note") : "",
        }),
      "역할을 등록했습니다. 기간과 담당 범위를 확인해 주세요.",
      (message, error) => setGrantFeedback({ message, error }),
    );
  }
  async function register(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fields = new FormData(e.currentTarget);
    const data = {
      ...Object.fromEntries(fields),
      unit_ids: fields.getAll("unit_ids"),
    };
    if (!data.unit_ids.length) {
      setError("소속을 한 개 이상 선택해 주세요.");
      return;
    }
    let restored = false;
    await perform(
      async () => {
        const result = await api<{ restored: boolean }>("/users", data);
        restored = result.restored;
        registration.current?.close();
      },
      () =>
        restored
          ? "삭제했던 담당자 계정을 복구했습니다. 로컬 수신함에서 새 초대 인증을 완료해 주세요. 이전 역할은 복구되지 않습니다."
          : "가상 담당자를 등록했습니다. 로컬 수신함에서 초대 인증을 완료한 뒤 로그인할 수 있습니다.",
    );
  }
  async function revoke(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const reason = new FormData(e.currentTarget).get("reason");
    await perform(async () => {
      await api(`/assignments/${revokeRow?.id}/revoke`, { reason });
      revocation.current?.close();
      setRevokeRow(null);
    }, "역할을 회수했습니다. 연결된 의장 자격과 활동 이력을 함께 확인해 주세요.");
  }
  if (loading)
    return (
      <main className="loading">연이음의 업무 공간을 불러오고 있습니다…</main>
    );
  if (!user || !workspace)
    return (
      <main className="login-page">
        <section className="login-story">
          <Brand />
          <p className="eyebrow">YEONIEUM · STUDENT GOVERNANCE</p>
          <h1>
            담당자는 바뀌어도,
            <br />
            우리의 기록은 이어지도록.
          </h1>
          <p>
            연암공과대학교 학생자치기구의
            <br />
            자료와 업무를 연결하는 공동의 공간, 연이음.
          </p>
          <figure className="mascot-card">
            <img
              src="/brand/cornbee.png"
              alt="연암공과대학교 마스코트 커너비"
              width="168"
              height="168"
            />
            <figcaption>
              <strong>커너비와 함께 이어가요.</strong>우리의 활동과 기록이
              <br />
              다음 담당자에게 닿도록.
            </figcaption>
          </figure>
          <div className="story-foot">
            총학생회 · 학과협의회 · 신문방송국 · 연합동아리 · 모니터링단
          </div>
        </section>
        <section className="login-panel">
          <span className="pill">LOCAL PROTOTYPE</span>
          <h2>연이음에 오신 것을 환영합니다</h2>
          <p className="muted">
            가상 계정으로 조직과 권한 흐름을 확인해 보세요.
          </p>
          <form onSubmit={login}>
            <label>
              시연 계정
              {direct ? (
                <input
                  name="identifier"
                  required
                  autoComplete="username"
                  placeholder="등록한 가상 학번"
                />
              ) : (
                <select name="identifier" defaultValue="staff-demo">
                  <option value="staff-demo">
                    담당 선생님 · 최초 학회장 등록
                  </option>
                  <option value="student-chair">
                    의장 · 스마트소프트웨어학과 학회장 겸임
                  </option>
                  <option value="student-head">기계공학과 학회장</option>
                  <option value="student-vice">
                    스마트소프트웨어학과 부학회장
                  </option>
                  <option value="student-rep">
                    스마트소프트웨어학과 1학년 A반 대표
                  </option>
                  <option value="student-new">신규 담당자 · 역할 미부여</option>
                  <option value="student-other">총학생회 학생회장</option>
                </select>
              )}
            </label>
            <button
              className="text-button"
              type="button"
              onClick={() => setDirect(!direct)}
            >
              {direct ? "기본 시연 계정 선택" : "등록한 계정 직접 입력"}
            </button>
            <label>
              비밀번호
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                defaultValue="Yeonieum-demo-2026!"
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? "로그인 중…" : "업무 공간으로 들어가기 →"}
            </button>
          </form>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <aside className="demo-note">
            가상 데이터만 사용하는 로컬 시연입니다.
            <br />
            시연 비밀번호: <code>Yeonieum-demo-2026!</code>
            <br />
            실제 개인정보와 학교 자료는 입력하지 마세요.
          </aside>
        </section>
      </main>
    );
  const own = workspace.assignments.filter(
    (a) => a.user_id === user.id && a.effective,
  );
  const people = workspace.users.filter((p) => p.name.includes(search));
  const roleUnits = workspace.units.filter(
    (u) =>
      Boolean(u.active) &&
      workspace.grant_options.some((o) => o.unit_id === u.id),
  );
  const grantOrganizations = workspace.units.filter(
    (u) =>
      u.kind === "organization" &&
      u.active &&
      roleUnits.some((t) => t.org_id === u.id),
  );
  const roleOptions = workspace.grant_options.filter(
    (o) => o.unit_id === scopeId,
  );
  const registerUnits = workspace.units.filter((u) =>
    user.is_admin
      ? u.kind === "organization" && Boolean(u.active)
      : workspace.grant_options.some((o) => o.unit_id === u.id),
  );
  const nowYear = seoulYear(workspace.server_time);
  const listedAssignments = workspace.assignments.filter(
    (a) =>
      !a.revoked_at &&
      (a.role !== "chair" ||
        !workspace.assignments.some(
          (parent) => parent.id === a.prerequisite_id && !parent.revoked_at,
        )),
  );
  const canAudit = Boolean(
    user.is_admin || own.some((a) => ["head", "chair"].includes(a.role)),
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab("overview");
          }}
        >
          <Brand />
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav aria-label="주 메뉴">
          <button
            aria-label="대시보드"
            className={tab === "overview" ? "active" : ""}
            onClick={() => setTab("overview")}
          >
            ◫ <span>대시보드</span>
          </button>
          <button
            aria-label="조직 · 권한"
            className={tab === "roles" ? "active" : ""}
            onClick={() => setTab("roles")}
          >
            ♧ <span>조직 · 권한</span>
          </button>
          <button
            aria-label="활동 이력"
            className={tab === "activity" ? "active" : ""}
            onClick={activity}
            disabled={!canAudit}
          >
            ↗ <span>활동 이력</span>
          </button>
        </nav>
        <div className="workspace-label upcoming">NEXT CHAPTER</div>
        <div className="future-list">
          <span>
            자료실 <small>준비 중</small>
          </span>
          <span>
            예산 · 지출 <small>설계 완료 후 구현</small>
          </span>
          <span>
            인수인계 <small>설계 완료 후 구현</small>
          </span>
        </div>
        <div className="sidebar-bottom">
          <span className="avatar">{user.name.slice(0, 1)}</span>
          <div>
            <strong>{user.name}</strong>
            <small>
              {user.is_admin
                ? "학생성공센터 · 관리자"
                : own
                    .map((a) => a.role_label || workspace.roles[a.role])
                    .join(" · ") || "역할 미부여"}
            </small>
          </div>
          <button onClick={logout} aria-label="로그아웃">
            ↪
          </button>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <span className="school-identity">
            <img
              src="/brand/university-symbol.png"
              alt=""
              width="30"
              height="30"
            />
            연암공과대학교 <span className="divider">/</span> 학생자치기구
          </span>
          <span className="pill">가상 데이터 · 로컬 시연</span>
          <button className="mobile-signout" onClick={logout}>
            로그아웃
          </button>
        </header>
        <main className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {tab === "overview"
                  ? "YOUR CONNECTED WORKSPACE"
                  : tab === "roles"
                    ? "PEOPLE & RESPONSIBILITIES"
                    : "ACTIVITY LOG"}
              </p>
              <h1>
                {tab === "overview"
                  ? "대시보드"
                  : tab === "roles"
                    ? "조직과 담당자 관리"
                    : "업무의 흐름을 기록합니다"}
              </h1>
              <p className="muted">
                {tab === "overview"
                  ? `${user.name}님, 오늘의 담당 범위와 역할을 확인하세요.`
                  : tab === "roles"
                    ? "직책과 담당 범위, 임기를 함께 확인하고 권한을 부여합니다."
                    : "역할 변경의 주체와 시각을 확인하세요."}
              </p>
            </div>
            <div className="date-label">
              {date(workspace.server_time)}
              <small>현재 서버 시각 기준</small>
            </div>
          </div>
          {error && (
            <div role="alert" className="error banner">
              {error}
            </div>
          )}
          {notice && (
            <div role="status" className="success banner">
              {notice}
            </div>
          )}
          {tab === "overview" && (
            <Dashboard
              workspace={workspace}
              user={user}
              onManage={() => setTab("roles")}
            />
          )}
          {tab === "roles" && (
            <>
              {Boolean(user.is_admin) && (
                <OrganizationManagement
                  units={workspace.units}
                  onChanged={refresh}
                />
              )}
              {(Boolean(user.is_admin) ||
                workspace.unit_creation_options.length > 0) && (
                <StructureManagement
                  workspace={workspace}
                  onChanged={refresh}
                />
              )}
              <div className="panel">
                <div className="section-heading">
                  <div>
                    <h2>
                      담당자 목록 <span className="count">{people.length}</span>
                    </h2>
                    <p className="muted">
                      연락처와 학번은 허용된 관리 범위에서만 표시됩니다.
                    </p>
                  </div>
                  <button
                    className="primary"
                    disabled={!registerUnits.length}
                    onClick={() => registration.current?.showModal()}
                  >
                    ＋ 가상 담당자 등록
                  </button>
                </div>
                <label className="search">
                  담당자 검색
                  <input
                    placeholder="이름으로 검색"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>담당자</th>
                        <th>소속</th>
                        <th>담당 정보</th>
                        {Boolean(user.is_admin) && <th>관리</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {people.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <strong>{p.name}</strong>
                          </td>
                          <td>
                            {p.unit_ids?.length
                              ? p.unit_ids.map((id) => (
                                  <div key={id}>{path(id)}</div>
                                ))
                              : "학생성공센터"}
                          </td>
                          <td>
                            {p.identifier ? (
                              <>
                                <div>{p.identifier}</div>
                                {p.email_verified === 0 && (
                                  <small>초대 인증 대기(로컬)</small>
                                )}
                                <small>
                                  {p.email} · {p.phone}
                                </small>
                              </>
                            ) : (
                              <span className="muted">열람 범위 제한</span>
                            )}
                          </td>
                          {Boolean(user.is_admin) && (
                            <td>
                              {!p.is_admin && (
                                <button
                                  className="text-button"
                                  onClick={() => setRemovePerson(p)}
                                  aria-label={`${p.name} 제거`}
                                >
                                  제거
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!people.length && (
                    <p className="empty">검색 결과가 없습니다.</p>
                  )}
                </div>
              </div>
              <AcademicGroups groups={workspace.sharing_groups} />
              {registerUnits.length > 0 && (
                <InvitationOutbox workspace={workspace} onChanged={refresh} />
              )}
              <div className="two-columns roles-layout">
                <section className="panel">
                  <h2>역할과 임기</h2>
                  <p className="muted">
                    계정별 업무 권한·담당 범위·유효기간을 관리합니다. 역할
                    회수는 계정을 제거하지 않습니다. 회수된 역할은 이 목록에서
                    숨기며 활동 이력은 보존합니다.
                  </p>
                  <div className="assignment-list">
                    {listedAssignments.map((a) => (
                      <article key={a.id} className="assignment">
                        <div>
                          <span
                            className={`state ${a.effective ? "live" : ""}`}
                          >
                            {a.effective
                              ? "유효"
                              : new Date(a.starts_at) >
                                  new Date(workspace.server_time)
                                ? "시작 대기"
                                : "비활성"}
                          </span>
                          <h3>
                            {workspace.users.find((p) => p.id === a.user_id)
                              ?.name || "이전 담당자"}{" "}
                            <small>
                              {a.role_label || workspace.roles[a.role]}
                            </small>
                          </h3>
                          <p>{path(a.unit_id)}</p>
                          <small>
                            {date(a.starts_at)} —{" "}
                            {date(lastIncludedInstant(a.ends_at))}
                          </small>
                          <AcademicChairControls
                            assignment={a}
                            workspace={workspace}
                            admin={Boolean(user.is_admin)}
                            onAppoint={setChairCandidate}
                            onRevoke={(row) => {
                              setRevokeRow(row);
                              revocation.current?.showModal();
                            }}
                          />
                        </div>
                        {!a.revoked_at &&
                          a.user_id !== user.id &&
                          (user.is_admin ||
                            workspace.grant_options.some(
                              (o) =>
                                o.unit_id === a.unit_id && o.role === a.role,
                            )) && (
                            <button
                              className="text-button"
                              onClick={() => {
                                setRevokeRow(a);
                                revocation.current?.showModal();
                              }}
                            >
                              회수
                            </button>
                          )}
                      </article>
                    ))}
                  </div>
                  {!listedAssignments.length && (
                    <p className="empty">조회 가능한 역할이 없습니다.</p>
                  )}
                </section>
                <section className="panel grant-panel">
                  <h2>역할 부여</h2>
                  <p className="muted">
                    단체와 담당 범위를 먼저 선택하면 부여할 수 있는 역할이
                    표시됩니다. 본인의 권한은 변경할 수 없습니다.
                  </p>
                  {roleUnits.length ? (
                    <form
                      onSubmit={grant}
                      onInvalid={() =>
                        setGrantFeedback({
                          message:
                            "담당자·역할·담당 범위·임기 등 필수 입력을 확인해 주세요.",
                          error: true,
                        })
                      }
                    >
                      <label>
                        단체
                        <select
                          aria-label="단체"
                          value={grantOrgId}
                          required
                          onChange={(e) => {
                            setGrantOrgId(e.target.value);
                            setScopeId("");
                            setRole("");
                            setRecipientId("");
                            setGrantFeedback(null);
                          }}
                        >
                          <option value="" disabled>
                            단체 선택
                          </option>
                          {grantOrganizations.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        담당 범위
                        <select
                          aria-label="담당 범위"
                          name="unit_id"
                          value={scopeId}
                          required
                          disabled={!grantOrgId}
                          onChange={(e) => {
                            setScopeId(e.target.value);
                            setRole("");
                            setRecipientId("");
                            setGrantFeedback(null);
                          }}
                        >
                          <option value="" disabled>
                            단체 전체 또는 하위 조직 선택
                          </option>
                          {roleUnits
                            .filter((u) => u.org_id === grantOrgId)
                            .map((u) => (
                              <option key={u.id} value={u.id}>
                                {path(u.id)}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        역할
                        <select
                          aria-label="역할"
                          name="role"
                          value={role}
                          required
                          disabled={!scopeId}
                          onChange={(e) => {
                            setRole(e.target.value);
                            setGrantFeedback(null);
                          }}
                        >
                          <option value="" disabled>
                            범위에 맞는 역할 선택
                          </option>
                          {roleOptions.map((o) => (
                            <option key={o.role} value={o.role}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        대상 담당자
                        <select
                          name="user_id"
                          required
                          value={recipientId}
                          disabled={!role}
                          onChange={(e) => {
                            setRecipientId(e.target.value);
                            setGrantFeedback(null);
                          }}
                        >
                          <option value="" disabled>
                            담당자 선택
                          </option>
                          {workspace.users
                            .filter((p) => p.id !== user.id && !p.is_admin)
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      {role === "chair" ? (
                        <>
                          <label>
                            선출자의 학회장 자격
                            <select
                              name="prerequisite_id"
                              key={recipientId}
                              required
                              defaultValue=""
                            >
                              <option value="" disabled>
                                공식 임기를 공유할 학회장 자격
                              </option>
                              {workspace.assignments
                                .filter(
                                  (a) =>
                                    a.role === "department_head" &&
                                    a.effective &&
                                    a.user_id === recipientId,
                                )
                                .map((a) => (
                                  <option value={a.id} key={a.id}>
                                    {
                                      workspace.users.find(
                                        (p) => p.id === a.user_id,
                                      )?.name
                                    }{" "}
                                    · {path(a.unit_id)} ({date(a.starts_at)} —{" "}
                                    {date(lastIncludedInstant(a.ends_at))})
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label>
                            선출 확인 내용
                            <textarea
                              name="election_note"
                              required
                              maxLength={300}
                              placeholder="학회장 투표에 따른 선출 결과 확인 내용을 입력하세요."
                            />
                          </label>
                          <p className="form-note">
                            의장 임기는 연결된 본인의 학회장 임기와 같습니다.
                            투표 자체를 이 화면에서 진행하지 않습니다.
                          </p>
                        </>
                      ) : (
                        <div className="date-inputs">
                          <label>
                            임기 시작
                            <input
                              name="starts_at"
                              type="date"
                              required
                              defaultValue={`${nowYear}-01-01`}
                            />
                          </label>
                          <label>
                            임기 종료 (당일 포함)
                            <input
                              name="ends_at"
                              type="date"
                              required
                              defaultValue={`${nowYear}-12-31`}
                            />
                          </label>
                        </div>
                      )}
                      {grantFeedback && (
                        <p
                          role={grantFeedback.error ? "alert" : "status"}
                          className={grantFeedback.error ? "error" : "success"}
                        >
                          {grantFeedback.message}
                        </p>
                      )}
                      <button className="primary" disabled={busy}>
                        {busy ? "저장 중…" : "역할 부여하기"}
                      </button>
                    </form>
                  ) : (
                    <div className="empty">
                      현재 역할에는 추가 역할 부여 권한이 없습니다.
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
          {tab === "activity" && (
            <section className="panel">
              <h2>최근 변경 이력</h2>
              <p className="muted">
                선생님은 전체, 최고 책임자는 자기 단체 이력을 조회합니다.
              </p>
              {history.map((item) => (
                <article className="audit-row" key={item.id}>
                  <span className="timeline-dot"></span>
                  <div>
                    <strong>{labels[item.action] || item.action}</strong>
                    <p>
                      {path(item.org_id)} · 처리자{" "}
                      {workspace.users.find((p) => p.id === item.actor_id)
                        ?.name || "이전 담당자"}
                    </p>
                    <small>
                      {new Date(item.at).toLocaleString("ko-KR")} · 대상{" "}
                      {item.target_id}
                    </small>
                  </div>
                </article>
              ))}
              {!history.length && !error && (
                <p className="empty">아직 기록된 변경이 없습니다.</p>
              )}
            </section>
          )}
          <footer>
            연이음 · 기록을 잇고, 다음을 준비합니다.
            <span>조직 · 권한 1차 프로토타입</span>
          </footer>
        </main>
      </div>
      <ChairDesignationDialog
        head={chairCandidate}
        workspace={workspace}
        onClose={() => setChairCandidate(null)}
        onChanged={refresh}
        onComplete={() => {
          setChairCandidate(null);
          setNotice("선출된 학회장에게 의장 표시를 연결했습니다.");
        }}
      />
      <RemovePersonDialog
        person={removePerson}
        onClose={() => setRemovePerson(null)}
        onChanged={refresh}
      />
      <dialog ref={registration}>
        <form onSubmit={register}>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="section-heading">
            <h2>가상 담당자 등록</h2>
            <button
              type="button"
              className="text-button"
              onClick={() => registration.current?.close()}
            >
              닫기
            </button>
          </div>
          <p className="muted">
            실제 개인정보를 입력하지 마세요. 등록 후 역할을 별도로 부여합니다.
          </p>
          <label>
            이름
            <input name="name" required maxLength={60} />
          </label>
          <label>
            초대 대상 이메일
            <input name="email" type="email" required />
          </label>
          <label>
            가상 학번
            <input
              name="identifier"
              required
              minLength={8}
              maxLength={8}
              pattern="[0-9]{8}"
              inputMode="numeric"
              title="학번은 숫자 8자리로 입력해 주세요."
            />
            <small className="muted">
              숫자 8자리 · 실제 학적 여부는 학교 연동 전까지 확인하지 않습니다.
            </small>
          </label>
          <label>
            가상 전화번호
            <input
              name="phone"
              type="tel"
              inputMode="numeric"
              required
              placeholder="010-0000-0000"
              maxLength={13}
              onChange={(e) => {
                e.target.value = formatPhone(e.target.value);
              }}
            />
          </label>
          <fieldset className="membership-options">
            <legend>소속 (여러 개 선택 가능)</legend>
            {registerUnits.map((u) => (
              <label key={u.id}>
                <input type="checkbox" name="unit_ids" value={u.id} />
                {path(u.id)}
              </label>
            ))}
            <small className="muted">
              한 개 이상 선택해 주세요. 소속을 추가해도 업무 권한은 자동
              부여되지 않습니다.
            </small>
          </fieldset>
          {Boolean(user.is_admin) && (
            <p className="form-note">
              단체만 선택해 등록한 뒤, 역할 부여에서 필요한 학과·학년·반 범위를
              지정합니다.
            </p>
          )}
          <label>
            시연 비밀번호
            <input
              name="password"
              type="password"
              required
              minLength={8}
              maxLength={128}
              pattern={String.raw`(?=.*[0-9])(?=.*[\p{P}\p{S}]).{8,128}`}
              title="8자 이상이며 숫자와 특수문자를 포함해야 합니다."
              defaultValue="Yeonieum-demo-2026!"
            />
          </label>
          <p className="form-note">
            비밀번호는 8자 이상, 숫자·특수문자 포함입니다. 등록 시 로컬 초대
            링크를 만들며 외부 이메일은 발송하지 않습니다. 삭제한 학번과
            이메일이 모두 같으면 기존 계정을 복구합니다.
          </p>
          <button className="primary" disabled={busy}>
            담당자 등록
          </button>
        </form>
      </dialog>
      <dialog ref={revocation}>
        <form onSubmit={revoke}>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <h2>역할 회수</h2>
          <p>
            회수된 역할은 다음 요청부터 사용할 수 없습니다.
            <br />
            학회장 자격에 연결된 의장 역할도 함께 종료됩니다.
          </p>
          <label>
            회수 사유
            <textarea name="reason" minLength={2} maxLength={300} required />
          </label>
          <div className="dialog-actions">
            <button type="button" onClick={() => revocation.current?.close()}>
              취소
            </button>
            <button className="danger" disabled={busy}>
              역할 회수
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
