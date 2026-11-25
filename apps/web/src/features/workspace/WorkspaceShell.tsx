import { useState, type ReactNode } from "react";
import Brand from "../../shared/Brand";
import type { Person, Workspace } from "../../shared/api";
import WorkspaceIcon from "./WorkspaceIcon";
import NotificationBell, {
  type NotificationTarget,
} from "../notifications/NotificationBell";

type Props = {
  workspace: Workspace;
  user: Person;
  tab: string;
  canAudit: boolean;
  onNavigate: (tab: string) => void;
  onActivity: () => void;
  onLogout: () => void;
  onOpenNotification: (target: NotificationTarget) => void;
  children: ReactNode;
};
const groups = [
  { label: "워크스페이스", items: [{ id: "overview", label: "대시보드" }] },
  {
    label: "기록과 업무",
    items: [
      { id: "documents", label: "자료실" },
      { id: "budgets", label: "예산 · 정산" },
      { id: "handovers", label: "인수인계" },
    ],
  },
  {
    label: "운영 관리",
    items: [
      { id: "roles", label: "조직 · 권한" },
      { id: "activity", label: "활동 이력" },
    ],
  },
] as const;
export default function WorkspaceShell({
  workspace,
  user,
  tab,
  canAudit,
  onNavigate,
  onActivity,
  onLogout,
  onOpenNotification,
  children,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const own = workspace.assignments.filter(
    (a) => a.user_id === user.id && a.effective,
  );
  const organizations = workspace.units.filter(
    (u) =>
      u.active &&
      u.kind === "organization" &&
      (Boolean(user.is_admin) ||
        own.some(
          (a) =>
            workspace.units.find((t) => t.id === a.unit_id)?.org_id === u.id,
        )),
  );
  const roleLabel = user.is_admin
    ? "학생성공센터 · 관리자"
    : own.map((a) => a.role_label || workspace.roles[a.role]).join(" · ") ||
      "역할 미부여";
  return (
    <div
      className={`app-shell workspace-shell ${collapsed ? "is-collapsed" : ""}`}
    >
      <a className="workspace-skip" href="#workspace-content">
        본문으로 바로가기
      </a>
      <header className="workspace-header">
        <button
          className="workspace-home"
          aria-label="연이음 홈"
          onClick={() => onNavigate("overview")}
        >
          <Brand />
        </button>
        <span className="workspace-school">
          연암공과대학교 <span>/</span> 학생자치기구 통합 운영
        </span>
        <div className="workspace-header-actions">
          <span className="workspace-demo">로컬 시연</span>
          <NotificationBell key={user.id} onOpenTarget={onOpenNotification} />
          <div
            className="workspace-account"
            title={`${user.name} · ${roleLabel}`}
          >
            <span className="avatar">{user.name.slice(0, 1)}</span>
            <div>
              <strong>{user.name}</strong>
              <small>{user.is_admin ? "서비스 관리자" : "운영 담당자"}</small>
            </div>
          </div>
          <button
            className="workspace-signout"
            aria-label="로그아웃"
            onClick={onLogout}
          >
            <WorkspaceIcon name="logout" />
            <span>로그아웃</span>
          </button>
        </div>
      </header>
      <aside className="sidebar workspace-sidebar">
        <button
          className="workspace-collapse"
          aria-label={collapsed ? "메뉴 펼치기" : "메뉴 접기"}
          aria-expanded={!collapsed}
          aria-controls="workspace-navigation"
          onClick={() => setCollapsed(!collapsed)}
        >
          <WorkspaceIcon name="chevron" />
        </button>
        <div className="workspace-selector">
          <span className="workspace-selector-mark">연</span>
          <div>
            <strong>연이음 워크스페이스</strong>
            <small>{user.is_admin ? "전체 단체 관리" : "나의 담당 업무"}</small>
          </div>
        </div>
        <nav id="workspace-navigation" aria-label="주 메뉴">
          {groups.map((group) => (
            <div className="workspace-nav-group" key={group.label}>
              <p className="workspace-nav-label">{group.label}</p>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  aria-label={item.label}
                  aria-current={tab === item.id ? "page" : undefined}
                  className={tab === item.id ? "active" : ""}
                  disabled={item.id === "activity" && !canAudit}
                  title={item.label}
                  onClick={() =>
                    item.id === "activity" ? onActivity() : onNavigate(item.id)
                  }
                >
                  <WorkspaceIcon name={item.id} />
                  <span className="workspace-nav-text">{item.label}</span>
                  {item.id === "roles" && (
                    <small className="workspace-nav-count">
                      {workspace.users.length}
                    </small>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="workspace-scope">
          <p className="workspace-nav-label">
            {user.is_admin ? "관리 중인 단체" : "나의 담당 단체"}
          </p>
          <div>
            {organizations.map((org) => (
              <span key={org.id}>{org.name}</span>
            ))}
          </div>
          {!organizations.length && (
            <small>역할을 부여받으면 담당 단체가 표시됩니다.</small>
          )}
        </div>
        <div className="workspace-sidebar-note">
          <span className="workspace-note-dot" />
          기록을 잇고, 다음을 준비합니다.
          <small>담당 범위에 맞는 업무를 확인하세요.</small>
        </div>
      </aside>
      <div className="main-column workspace-main">
        <div className="workspace-banner">
          <span>
            <i />
            담당자는 바뀌어도, 우리의 기록은 이어지도록.
          </span>
          <small>{user.is_admin ? "전체 운영 현황" : "나의 업무 공간"}</small>
        </div>
        <div id="workspace-content" className="workspace-body" tabIndex={-1}>
          {children}
        </div>
      </div>
    </div>
  );
}
