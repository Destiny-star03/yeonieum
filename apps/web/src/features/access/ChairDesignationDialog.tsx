import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type Assignment, type Workspace } from "../../shared/api";
import { formatDate, lastIncludedInstant } from "../../shared/tenure";
type Props = {
  head: Assignment | null;
  workspace: Workspace;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onComplete: () => void;
};
export default function ChairDesignationDialog({
  head,
  workspace,
  onClose,
  onChanged,
  onComplete,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setNote("");
    setError("");
    if (head) dialog.current?.showModal();
    else dialog.current?.close();
  }, [head]);
  const otherChair = workspace.assignments.find(
    (a) => a.role === "chair" && a.effective && a.prerequisite_id !== head?.id,
  );
  const person = workspace.users.find((p) => p.id === head?.user_id)?.name;
  async function appoint(e: FormEvent) {
    e.preventDefault();
    if (!head) return;
    setBusy(true);
    setError("");
    try {
      await api("/assignments", {
        user_id: head.user_id,
        unit_id: "council",
        role: "chair",
        starts_at: head.starts_at,
        ends_at: head.ends_at,
        prerequisite_id: head.id,
        election_note: note,
      });
      await onChanged();
      onComplete();
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
      <form onSubmit={appoint}>
        <h2>학회장에게 의장 표시</h2>
        <p>
          {person}님의 학회장 자격에 의장을 연결합니다. 학회장 투표로 선출된
          사실을 확인해 주세요.
        </p>
        {head && (
          <p className="form-note">
            공식 임기: {formatDate(head.starts_at)} ~{" "}
            {formatDate(lastIncludedInstant(head.ends_at))}
            <br />
            학회장과 같은 임기이며 학회장 자격이 끝나면 의장도 종료됩니다.
          </p>
        )}
        {otherChair && (
          <p role="alert" className="error">
            현재 다른 의장이 지정되어 있습니다. 기존 의장의 ‘의장 해제’를 먼저
            진행해 주세요.
          </p>
        )}
        <label>
          선출 확인 내용
          <textarea
            required
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="학회장 투표에 따른 선출 결과를 확인한 내용을 입력해 주세요."
          />
        </label>
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
            className="primary"
            disabled={busy || !note.trim() || Boolean(otherChair)}
          >
            의장 지정 완료
          </button>
        </div>
      </form>
    </dialog>
  );
}
