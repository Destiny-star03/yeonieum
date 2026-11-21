import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../shared/api";
import type { LibraryFolder, LibraryOptions } from "./api";

export default function FolderDialog({
  options,
  year,
  org,
  audience,
  parent,
  onClose,
  onSaved,
}: {
  options: LibraryOptions;
  year: number;
  org: string;
  audience: "private" | "organization";
  parent: LibraryFolder | null;
  onClose: () => void;
  onSaved: (folder: LibraryFolder) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [selectedOrg, setSelectedOrg] = useState(
    org || options.units[0]?.org_id || "",
  );
  const [selectedYear, setSelectedYear] = useState(year);
  const [sharing, setSharing] = useState(audience);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [saved, setSaved] = useState<LibraryFolder | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    let folder = saved;
    try {
      if (!folder) {
        const data = {
          name,
          org_id: selectedOrg,
          academic_year: selectedYear,
          audience: sharing,
          parent_id: parent?.id || null,
        };
        const result = await api<{ id: string }>("/documents/folders", data);
        folder = { ...data, id: result.id, created_by: "" };
        setSaved(folder);
      }
      await onSaved(folder);
      onClose();
    } catch (e) {
      setError(
        `${folder ? "폴더가 생성되었습니다. 결과를 다시 확인해 주세요. " : ""}${(e as Error).message}`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="library-dialog library-folder-dialog"
      aria-labelledby="folder-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit}>
        <span className="library-kicker">A PLACE FOR OUR RECORDS</span>
        <h2 id="folder-dialog-title">새 폴더 만들기</h2>
        <fieldset
          className="library-upload-fields"
          disabled={busy || Boolean(saved)}
        >
          <label>
            폴더 이름
            <input
              autoFocus
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 정기 회의, 행사 준비"
            />
          </label>
          <div className="library-field-grid">
            <label>
              보관 연도
              <input
                type="number"
                required
                min={1900}
                max={2200}
                disabled={Boolean(parent)}
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
              />
            </label>
            <label>
              보관 단체
              <select
                required
                disabled={Boolean(parent)}
                value={selectedOrg}
                onChange={(e) => setSelectedOrg(e.target.value)}
              >
                {options.organizations
                  .filter((o) => options.units.some((u) => u.org_id === o.id))
                  .map((o) => (
                    <option value={o.id} key={o.id}>
                      {o.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <label>
            폴더 공개 범위
            <select
              disabled={Boolean(parent)}
              value={sharing}
              onChange={(e) => setSharing(e.target.value as typeof sharing)}
            >
              <option value="private">개인 보관 · 나만 보기</option>
              <option value="organization">단체 공유 · 단체 담당자</option>
            </select>
          </label>
          <p className="form-note">
            {parent
              ? `‘${parent.name}’ 안에 만듭니다. 상위 폴더의 연도·단체·공유 방식을 따릅니다.`
              : "연도와 단체 아래에 만듭니다. 이 폴더 안의 파일과 하위 폴더도 같은 공개 범위를 따릅니다."}
          </p>
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="library-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            취소
          </button>
          <button className="primary" disabled={busy || !selectedOrg}>
            {busy ? "만드는 중…" : saved ? "결과 다시 확인" : "폴더 만들기"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
