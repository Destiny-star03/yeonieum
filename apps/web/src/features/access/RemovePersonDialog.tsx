import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type Person } from "../../shared/api";

type Props = {
  person: Person | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
};
export default function RemovePersonDialog({
  person,
  onClose,
  onChanged,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setConfirmation("");
    setError("");
    if (person) dialog.current?.showModal();
    else dialog.current?.close();
  }, [person]);
  async function remove(e: FormEvent) {
    e.preventDefault();
    if (!person || confirmation !== "제거하겠습니다") return;
    setBusy(true);
    setError("");
    try {
      await api(`/users/${person.id}/remove`, { confirmation });
      await onChanged();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form onSubmit={remove}>
        <h2>담당자를 제거하시겠습니까?</h2>
        <p>
          {person?.name}님의 로그인과 업무 권한이 중단됩니다. 기존 역할·감사
          이력은 보존합니다.
        </p>
        <label>
          확인 문구
          <input
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="off"
            placeholder="제거하겠습니다"
            required
          />
        </label>
        <p className="form-note">
          계속하려면 ‘제거하겠습니다’를 정확히 입력해 주세요.
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            취소
          </button>
          <button
            className="danger"
            disabled={busy || confirmation !== "제거하겠습니다"}
          >
            {busy ? "제거 중…" : "담당자 제거"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
