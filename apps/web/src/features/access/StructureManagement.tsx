import ConvertClassDialog from "./ConvertClassDialog";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  api,
  type Workspace,
  type RoleDefinition,
  type Unit,
} from "../../shared/api";
type Props = {
  workspace: Workspace;
  onChanged: () => Promise<void>;
  onClassReady: (unitId: string) => void;
};
export default function StructureManagement({
  workspace,
  onChanged,
  onClassReady,
}: Props) {
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
  const unitDialog = useRef<HTMLDialogElement>(null);
  const [unitTarget, setUnitTarget] = useState<Unit | null>(null);
  const [unitConfirmed, setUnitConfirmed] = useState(false);
  const [convertTarget, setConvertTarget] = useState<Unit | null>(null);
  useEffect(() => {
    if (orgId && !workspace.units.some((u) => u.id === orgId && u.active)) {
      setOrgId("");
      setParentId("");
    } else if (
      parentId &&
      !workspace.unit_creation_options.some((o) => o.parent_id === parentId)
    ) {
      setParentId("");
    }
  }, [workspace, orgId, parentId]);
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
  const childUnits = workspace.units.filter(
    (u) =>
      u.active &&
      u.kind !== "organization" &&
      u.org_id === orgId &&
      (!parentId || u.parent_id === parentId),
  );
  function path(id: string): string {
    const u = workspace.units.find((u) => u.id === id);
    return u ? (u.parent_id ? `${path(u.parent_id)} / ${u.name}` : u.name) : id;
  }
  async function perform(
    action: () => Promise<unknown>,
    message: string | (() => string),
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await onChanged();
      setNotice(typeof message === "function" ? message() : message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function addUnit(e: FormEvent) {
    e.preventDefault();
    let restored = false;
    let createdId = "";
    await perform(
      async () => {
        const result = await api<{ id: string; restored: boolean }>("/units", {
          parent_id: parentId,
          kind: unitKind,
          name: unitName,
        });
        restored = result.restored;
        createdId = result.id;
        setUnitName("");
      },
      () => {
        if (unitKind === "class" && createdId) onClassReady(createdId);
        return restored
          ? "삭제했던 하위 조직을 복원했습니다. 이전 역할은 자동 복구되지 않습니다."
          : unitKind === "year"
            ? "하위 조직을 등록했습니다. 현재 항목은 학년입니다. 상위 조직에서 이 학년을 선택한 뒤 A반·SAP반 등을 등록해 주세요."
            : "하위 조직을 등록했습니다. 역할 부여에서 해당 범위를 선택할 수 있습니다.";
      },
    );
  }
  async function removeUnit(e: FormEvent) {
    e.preventDefault();
    if (!unitTarget || !unitConfirmed) return;
    await perform(async () => {
      await api(`/units/${unitTarget.id}/remove`, {
        confirmed: unitConfirmed,
      });
      unitDialog.current?.close();
      setUnitTarget(null);
    }, "하위 조직과 그 아래 조직을 삭제하고 역할을 회수했습니다. 계정과 과거 이력은 보존됩니다. 조직을 복원해도 역할은 다시 부여해야 합니다.");
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
          {orgId === "council" && (
            <p className="form-note academic-structure-guide">
              <strong>반대표 등록 순서: 학과 → 학년 → 반 → 반대표 역할</strong>
              <br />
              학과를 상위 조직으로 선택하면 학년을 등록합니다. 반은 반드시 해당
              학년을 상위 조직으로 선택해 등록하세요. 예: 스마트소프트웨어학과 →
              1학년 → A반.
            </p>
          )}
          <div
            className={`structure-forms ${canManageRoles ? "" : "single-column"}`}
          >
            <form onSubmit={addUnit}>
              <h3>
                {unitKind === "year"
                  ? "학년 등록"
                  : unitKind === "class"
                    ? "반 등록"
                    : "하위 조직 등록"}
              </h3>
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
              {unitKind === "year" &&
                /^[0-9]+\s*[A-Za-z]+(?:반)?$/.test(unitName.trim()) && (
                  <p className="error" role="alert">
                    지금은 학년 등록입니다. 1A·3SAP 대신 1학년·3학년을 등록하고,
                    그 학년 아래에 A반·SAP반을 추가해 주세요.
                  </p>
                )}
              <button
                className="primary"
                disabled={
                  busy ||
                  !unitKind ||
                  (unitKind === "year" &&
                    /^[0-9]+\s*[A-Za-z]+(?:반)?$/.test(unitName.trim()))
                }
              >
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
          <div className="registered-units">
            <h3>등록된 하위 조직</h3>
            <p className="muted">
              상위 조직을 선택하면 바로 아래 조직을 표시합니다. 같은 이름으로
              다시 등록하면 삭제한 조직을 복원합니다.
            </p>
            <ul className="unit-list">
              {childUnits.map((u) => (
                <li key={u.id} data-unit-id={u.id}>
                  <div>
                    <strong>{path(u.id)}</strong>
                    <small>{workspace.scope_kinds[u.kind]}</small>
                  </div>
                  {u.kind === "year" &&
                    (workspace.unit_deletion_options || []).includes(u.id) &&
                    !workspace.units.some(
                      (child) => child.parent_id === u.id,
                    ) &&
                    !workspace.assignments.some((a) => a.unit_id === u.id) && (
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        aria-label={`${path(u.id)} 반으로 변경`}
                        onClick={() => setConvertTarget(u)}
                      >
                        반으로 변경
                      </button>
                    )}
                  {(workspace.unit_deletion_options || []).includes(u.id) ? (
                    <button
                      className="text-button"
                      disabled={busy}
                      aria-label={`${path(u.id)} 하위 조직 삭제`}
                      onClick={() => {
                        setUnitTarget(u);
                        setUnitConfirmed(false);
                        setError("");
                        setNotice("");
                        unitDialog.current?.showModal();
                      }}
                    >
                      삭제
                    </button>
                  ) : (
                    <small>삭제 권한 없음</small>
                  )}
                </li>
              ))}
            </ul>
            {!childUnits.length && (
              <p className="muted">표시할 하위 조직이 없습니다.</p>
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
      {error && !target && !unitTarget && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      <ConvertClassDialog
        target={convertTarget}
        workspace={workspace}
        onClose={() => setConvertTarget(null)}
        onChanged={onChanged}
        onComplete={(id) => {
          setConvertTarget(null);
          setNotice(
            "반으로 변경했습니다. 역할 부여에서 반대표를 선택하고 대상 담당자를 지정해 주세요.",
          );
          onClassReady(id);
        }}
        onPrepareYear={(departmentId, yearName) => {
          setConvertTarget(null);
          setParentId(departmentId);
          setUnitName(yearName);
          setNotice(
            "학년을 등록·복원한 다음, 기존 항목의 ‘반으로 변경’을 다시 눌러 주세요. 삭제된 학년 복원 시 함께 삭제된 하위 조직도 복원되며, 회수된 역할은 복구되지 않습니다.",
          );
        }}
      />
      <dialog
        ref={unitDialog}
        aria-labelledby="unit-delete-title"
        onCancel={(e) => {
          e.preventDefault();
          if (!busy) {
            unitDialog.current?.close();
            setUnitTarget(null);
            setError("");
          }
        }}
      >
        <form onSubmit={removeUnit}>
          <h2 className="delete-warning-title" id="unit-delete-title">
            정말로 삭제하시겠습니까?
          </h2>
          <p className="delete-target">
            삭제 대상: <strong>{unitTarget?.name}</strong>
          </p>
          <section className="delete-notice" id="unit-delete-notice">
            <h3>삭제 전 꼭 확인해 주세요</h3>
            <ul>
              <li>
                <strong>
                  선택한 하위 조직과 그 아래 조직이 함께 삭제됩니다.
                </strong>
              </li>
              <li>
                해당 조직의 <strong>현재·예약 역할이 모두 회수</strong>되어 업무
                권한을 사용할 수 없습니다.
              </li>
              {unitTarget?.kind === "department" && (
                <li>
                  학회장 자격에 연결된 <strong>의장 자격도 종료</strong>됩니다.
                </li>
              )}
              <li>담당자 계정과 과거 이력은 보존됩니다.</li>
              <li>
                같은 상위 조직에 같은 이름으로 재등록하면 조직을 복원할 수
                있지만, <strong>역할은 다시 부여해야 합니다.</strong> 이전에
                따로 삭제한 하위 조직은 함께 복원되지 않습니다.
              </li>
            </ul>
          </section>
          <label className="delete-consent">
            <input
              type="checkbox"
              required
              checked={unitConfirmed}
              disabled={busy}
              onChange={(e) => setUnitConfirmed(e.target.checked)}
              aria-describedby="unit-delete-notice"
            />
            <strong>유의사항을 확인했으며, 삭제하겠습니다.</strong>
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
                unitDialog.current?.close();
                setUnitTarget(null);
                setError("");
              }}
            >
              취소
            </button>
            <button className="danger" disabled={busy || !unitConfirmed}>
              하위 조직 삭제
            </button>
          </div>
        </form>
      </dialog>
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
