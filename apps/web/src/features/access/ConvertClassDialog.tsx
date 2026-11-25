import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type Unit, type Workspace } from "../../shared/api";

type Props = {
  target: Unit | null;
  workspace: Workspace;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onComplete: (unitId: string) => void;
  onPrepareYear: (departmentId: string, yearName: string) => void;
};
export default function ConvertClassDialog({
  target,
  workspace,
  onClose,
  onChanged,
  onComplete,
  onPrepareYear,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [yearId, setYearId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const years = workspace.units.filter(
    (u) =>
      u.active &&
      u.kind === "year" &&
      u.parent_id === target?.parent_id &&
      u.id !== target?.id &&
      !/^[0-9]+\s*[A-Za-z]+(?:반)?$/.test(u.name) &&
      workspace.unit_creation_options.some((o) => o.parent_id === u.id),
  );
  const suggestedYear = `${target?.name.match(/^[0-9]+/)?.[0] || "1"}학년`;
  useEffect(() => {
    if (target) {
      const match = target.name.match(/^[0-9]+\s*([A-Za-z]+)(?:반)?$/);
      setName(match ? `${match[1]}반` : target.name);
      setYearId(
        workspace.units.find(
          (u) =>
            u.active &&
            u.kind === "year" &&
            u.parent_id === target.parent_id &&
            u.name === `${target.name.match(/^[0-9]+/)?.[0] || "1"}학년`,
        )?.id || "",
      );
      setError("");
      dialog.current?.showModal();
    } else dialog.current?.close();
  }, [target, workspace.units]);
  async function convert(e: FormEvent) {
    e.preventDefault();
    if (!target || !yearId) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ id: string }>(
        `/units/${target.id}/convert-to-class`,
        { parent_id: yearId, name },
      );
      await onChanged();
      onComplete(result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby="convert-class-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form onSubmit={convert}>
        <h2 id="convert-class-title">학년으로 등록된 항목을 반으로 변경</h2>
        <p>
          <strong>{target?.name}</strong> 항목을 올바른 학년 아래의 반으로
          옮깁니다. 변경 후 반대표 역할의 담당 범위에서 선택할 수 있습니다.
        </p>
        <label>
          소속 학년
          <select
            required
            value={yearId}
            onChange={(e) => setYearId(e.target.value)}
          >
            <option value="">학년 선택</option>
            {years.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          반 이름
          <input
            required
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: A반, SAP반"
          />
        </label>
        <p className="form-note">
          반을 소속시킬 학년이 없다면 먼저 학년을 등록·복원해 주세요. 기존 계정
          소속은 유지하며, 변경 이력을 남깁니다. 하위 조직이나 역할 이력이 있는
          항목은 변경하지 않습니다.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (target?.parent_id)
              onPrepareYear(target.parent_id, suggestedYear);
          }}
        >
          먼저 {suggestedYear} 등록·복원하기
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            취소
          </button>
          <button className="primary" disabled={busy || !yearId}>
            반으로 변경
          </button>
        </div>
      </form>
    </dialog>
  );
}
