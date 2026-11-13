import { useRef, useState, type FormEvent } from "react";
import { api, type Unit } from "../../shared/api";

type Props = { units: Unit[]; onChanged: () => Promise<void> };
export default function OrganizationManagement({ units, onChanged }: Props) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState<Unit | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ restored: boolean }>("/organizations", {
        name,
      });
      await onChanged();
      setName("");
      setNotice(
        result.restored
          ? "삭제했던 단체를 복원했습니다. 담당자 권한은 별도로 부여해 주세요."
          : "단체를 추가했습니다.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(e: FormEvent) {
    e.preventDefault();
    if (!target) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`/organizations/${target.id}/remove`, { confirmation });
      await onChanged();
      dialog.current?.close();
      setTarget(null);
      setNotice("단체를 삭제했습니다. 기존 이력은 보존됩니다.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>단체 관리</h2>
      <p className="muted">
        담당 선생님이 운영 단체를 추가하거나 삭제합니다. 학과·학년·반은 역할의
        세부 담당 범위입니다.
      </p>
      <form className="organization-add" onSubmit={add}>
        <label>
          새 단체명
          <input
            required
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="신설 단체 이름"
          />
        </label>
        <button className="primary" disabled={busy || !name.trim()}>
          단체 추가
        </button>
      </form>
      <p className="muted">
        삭제했던 단체명을 입력하면 기존 단체와 하위 소속을 복원합니다. 이전
        담당자의 권한은 자동 복구되지 않습니다.
      </p>
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
      <ul className="organization-list">
        {units
          .filter((u) => u.kind === "organization" && u.active)
          .map((u) => (
            <li key={u.id}>
              <strong>{u.name}</strong>
              <button
                className="text-button"
                disabled={busy}
                aria-label={`${u.name} 삭제`}
                onClick={() => {
                  setTarget(u);
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
          <h2>단체를 삭제하시겠습니까?</h2>
          <p>
            {target?.name} 및 하위 범위의 업무 권한이 종료되고 등록 선택
            목록에서 제외됩니다. 계정과 과거 기록은 보존합니다.
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
          <p className="form-note">
            계속하려면 ‘삭제하겠습니다’를 정확히 입력해 주세요.
          </p>
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
              단체 삭제
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
