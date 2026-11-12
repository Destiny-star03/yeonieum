import { useRef, useState, type FormEvent } from "react";
import { api, type Workspace, type RoleDefinition } from "../../shared/api";
type Props = { workspace: Workspace; onChanged: () => Promise<void> };
export default function StructureManagement({ workspace, onChanged }: Props) {
  const [orgId, setOrgId] = useState(""),
    [parentId, setParentId] = useState(""),
    [unitName, setUnitName] = useState(""),
    [label, setLabel] = useState(""),
    [kind, setKind] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [target, setTarget] = useState<RoleDefinition | null>(null),
    [confirmation, setConfirmation] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const canManageRoles = workspace.can_manage_role_types;
  const orgs = workspace.units.filter(
    (u) =>
      u.kind === "organization" &&
      u.active &&
      (canManageRoles ||
        workspace.unit_creation_options.some((o) => o.org_id === u.id)),
  );
  const parents = workspace.units.filter(
    (u) =>
      u.org_id === orgId &&
      workspace.unit_creation_options.some((o) => o.parent_id === u.id),
  );
  const unitKind =
    workspace.unit_creation_options.find((o) => o.parent_id === parentId)
      ?.kind || "";
  const types = workspace.role_definitions.filter(
    (t) => t.org_id === orgId && t.active,
  );
  function path(id: string): string {
    const u = workspace.units.find((u) => u.id === id);
    return u ? (u.parent_id ? `${path(u.parent_id)} / ${u.name}` : u.name) : id;
  }
  async function perform(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await onChanged();
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function addUnit(e: FormEvent) {
    e.preventDefault();
    await perform(async () => {
      await api("/units", {
        parent_id: parentId,
        kind: unitKind,
        name: unitName,
      });
      setUnitName("");
    }, "하위 조직을 등록했습니다. 역할 부여에서 해당 범위를 선택할 수 있습니다.");
  }
  async function addRole(e: FormEvent) {
    e.preventDefault();
    await perform(async () => {
      await api("/role-types", { org_id: orgId, label, scope_kind: kind });
      setLabel("");
    }, "역할 종류를 추가·복원했습니다. 이전에 회수한 역할은 자동 복구되지 않습니다.");
  }
  async function remove(e: FormEvent) {
    e.preventDefault();
    if (!target) return;
    await perform(async () => {
      await api(`/role-types/${target.id}/remove`, { confirmation });
      dialog.current?.close();
      setTarget(null);
    }, "역할 종류를 삭제하고 해당 역할을 회수했습니다. 기존 이력은 보존됩니다.");
  }
  return (
    <section className="panel structure-management">
      <h2>
        {canManageRoles ? "하위 조직·역할 종류 관리" : "학과 하위 조직 관리"}
      </h2>
      <p className="muted">
        {canManageRoles
          ? "선생님은 하위 조직과 역할 종류를 관리합니다. 역할 이름을 추가해도 관리·회계 권한이 자동으로 생기지 않습니다."
          : "학회장은 자기 학과의 학년·반을 등록하고 반대표 계정과 역할을 지정할 수 있습니다. 반을 등록한 뒤 기본 반대표 역할을 선택하세요."}
      </p>
      <label>
        관리할 단체
        <select
          aria-label="관리할 단체"
          value={orgId}
          onChange={(e) => {
            setOrgId(e.target.value);
            setParentId("");
            setKind("");
            setError("");
            setNotice("");
          }}
        >
          <option value="">단체 선택</option>
          {orgs.map((o) => (
            <option value={o.id} key={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      {orgId && (
        <>
          <div
            className={`structure-forms ${canManageRoles ? "" : "single-column"}`}
          >
            <form onSubmit={addUnit}>
              <h3>하위 조직 등록</h3>
              <label>
                상위 조직
                <select
                  required
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                >
                  <option value="">상위 조직 선택</option>
                  {parents.map((u) => (
                    <option key={u.id} value={u.id}>
                      {path(u.id)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">
                추가할 종류:{" "}
                {workspace.scope_kinds[unitKind] || "상위 조직을 선택해 주세요"}
              </p>
              <label>
                하위 조직명
                <input
                  required
                  maxLength={60}
                  value={unitName}
                  onChange={(e) => setUnitName(e.target.value)}
                  placeholder={
                    unitKind === "year"
                      ? "예: 1학년"
                      : unitKind === "class"
                        ? "예: A반"
                        : "예: 기획부, 사진동아리"
                  }
                />
              </label>
              <button className="primary" disabled={busy || !unitKind}>
                하위 조직 등록
              </button>
            </form>
            {canManageRoles && (
              <form onSubmit={addRole}>
                <h3>역할 종류 추가</h3>
                <label>
                  역할 이름
                  <input
                    required
                    maxLength={60}
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="새 역할 이름"
                  />
                </label>
                <label>
                  역할 적용 범위
                  <select
                    required
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    <option value="">범위 종류 선택</option>
                    {(workspace.role_scope_kinds[orgId] || []).map((k) => (
                      <option value={k} key={k}>
                        {workspace.scope_kinds[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="primary" disabled={busy}>
                  역할 종류 추가
                </button>
              </form>
            )}
          </div>
          {canManageRoles && (
            <ul className="role-type-list">
              {types.map((t) => (
                <li key={t.id}>
                  <div>
                    <strong>{t.label}</strong>
                    <small>
                      {workspace.scope_kinds[t.scope_kind]} ·{" "}
                      {t.builtin ? "기본 역할" : "추가 역할"}
                    </small>
                  </div>
                  <button
                    className="text-button"
                    aria-label={`${t.label} 역할 종류 삭제`}
                    disabled={busy}
                    onClick={() => {
                      setTarget(t);
                      setConfirmation("");
                      setError("");
                      setNotice("");
                      dialog.current?.showModal();
                    }}
                  >
                    삭제
                  </button>
                </li>
              ))}
            </ul>
          )}
          {canManageRoles && !types.length && (
            <p className="muted">등록된 역할 종류가 없습니다.</p>
          )}
        </>
      )}
      {error && !target && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      <dialog
        ref={dialog}
        onCancel={(e) => {
          e.preventDefault();
          if (!busy) {
            dialog.current?.close();
            setTarget(null);
            setError("");
          }
        }}
      >
        <form onSubmit={remove}>
          <h2>역할 종류를 삭제하시겠습니까?</h2>
          <p>
            ‘{target?.label}’을 부여한 현재·예약 역할이 모두 회수됩니다. 학회장
            역할 종류를 삭제하면 연결된 의장 자격도 종료됩니다. 과거 이력은
            보존됩니다.
          </p>
          <label>
            확인 문구
            <input
              required
              placeholder="삭제하겠습니다"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                dialog.current?.close();
                setTarget(null);
                setError("");
              }}
            >
              취소
            </button>
            <button
              className="danger"
              disabled={busy || confirmation !== "삭제하겠습니다"}
            >
              역할 종류 삭제
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
