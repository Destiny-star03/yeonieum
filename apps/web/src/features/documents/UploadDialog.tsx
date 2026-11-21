import { useEffect, useRef, useState, type FormEvent } from "react";
import { seoulYear } from "../../shared/tenure";
import FileDropzone from "./FileDropzone";
import {
  uploadFile,
  type LibraryDocument,
  type LibraryMetadata,
  type LibraryOptions,
} from "./api";

export default function UploadDialog({
  target,
  options,
  time,
  onClose,
  onSaved,
  defaults,
  folderName,
}: {
  target: LibraryDocument | "new";
  options: LibraryOptions;
  time: string;
  onClose: () => void;
  onSaved: (id: string) => Promise<void>;
  defaults?: Partial<LibraryMetadata>;
  folderName?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [metadata, setMetadata] = useState<LibraryMetadata>({
    unit_id: "",
    title: "",
    description: "",
    academic_year: Number(seoulYear(time)),
    category: "일반 자료",
    folder: "",
    event: "",
    audience: "private",
    ...defaults,
  });
  const [file, setFile] = useState<File | null>(null),
    [note, setNote] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [uploadedId, setUploadedId] = useState("");
  const titleEdited = useRef(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const selected = options.units.find((u) => u.id === metadata.unit_id);
  const locked = busy || Boolean(uploadedId);
  const isNew = target === "new";
  function chooseFile(next: File | null) {
    setFile(next);
    setError("");
    if (next && !titleEdited.current) {
      const dot = next.name.lastIndexOf(".");
      const title = (dot > 0 ? next.name.slice(0, dot) : next.name)
        .trim()
        .slice(0, 150);
      setMetadata((old) => ({
        ...old,
        title: title || next.name.slice(0, 150),
      }));
    }
  }
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    if (
      isNew &&
      (!metadata.unit_id ||
        !Number.isInteger(metadata.academic_year) ||
        metadata.academic_year < 1900 ||
        metadata.academic_year > 2200)
    ) {
      setLocationOpen(true);
      setError("보관할 담당 범위와 학년도를 확인해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    let savedId = uploadedId;
    try {
      if (!savedId) {
        const result = await uploadFile(
          file,
          target === "new"
            ? { ...metadata, category: metadata.category.trim() || "일반 자료" }
            : null,
          target === "new" ? null : target,
          note,
        );
        savedId = result.id;
        setUploadedId(savedId);
      }
      await onSaved(savedId);
      onClose();
    } catch (e) {
      setError(
        savedId
          ? `파일 저장은 완료됐습니다. 화면 갱신을 다시 시도해 주세요. ${(e as Error).message}`
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="library-dialog library-upload-dialog"
      aria-labelledby="upload-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit}>
        <div className="library-upload-heading">
          <div>
            <span className="library-kicker">ADD TO YOUR ARCHIVE</span>
            <h2 id="upload-title">
              {target === "new" ? "자료 등록" : "새 버전 등록"}
            </h2>
            <p>
              {isNew
                ? "파일을 선택하면 제목은 자동으로 채워집니다."
                : "이전 파일은 그대로 보존하고 새 버전을 추가합니다."}
            </p>
          </div>
          <button
            type="button"
            className="library-upload-close"
            aria-label="등록창 닫기"
            disabled={busy}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <fieldset
          disabled={busy || Boolean(uploadedId)}
          className="library-upload-fields"
        >
          {isNew ? (
            <>
              <div className="library-upload-location">
                <span
                  className="library-upload-location-icon"
                  aria-hidden="true"
                >
                  ▱
                </span>
                <div>
                  <small>보관 위치</small>
                  <strong>
                    {metadata.academic_year}년 ·{" "}
                    {selected?.label || "담당 범위를 선택해 주세요"}
                    {folderName ? ` / ${folderName}` : ""}
                  </strong>
                </div>
                <button
                  type="button"
                  aria-expanded={locationOpen}
                  onClick={() => setLocationOpen(!locationOpen)}
                >
                  위치 변경
                </button>
              </div>
              {locationOpen && (
                <div className="library-upload-location-fields">
                  <label>
                    보관할 담당 범위
                    <select
                      required
                      value={metadata.unit_id}
                      onChange={(e) => {
                        const next = options.units.find(
                          (u) => u.id === e.target.value,
                        );
                        setMetadata({
                          ...metadata,
                          unit_id: e.target.value,
                          audience: next?.audiences.some(
                            (a) => a.key === metadata.audience,
                          )
                            ? metadata.audience
                            : "private",
                        });
                      }}
                    >
                      <option value="">범위 선택</option>
                      {options.units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    학년도
                    <input
                      type="number"
                      min={1900}
                      max={2200}
                      required
                      disabled={Boolean(metadata.folder_id)}
                      value={metadata.academic_year}
                      onChange={(e) =>
                        setMetadata({
                          ...metadata,
                          academic_year: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                </div>
              )}
              <div className="library-upload-basics">
                <label>
                  자료 제목
                  <input
                    maxLength={150}
                    required
                    value={metadata.title}
                    placeholder="파일 이름에서 자동 입력"
                    onChange={(e) => {
                      titleEdited.current = true;
                      setMetadata({ ...metadata, title: e.target.value });
                    }}
                  />
                </label>
                <label>
                  열람 대상
                  <select
                    value={metadata.audience}
                    disabled={Boolean(metadata.folder_id)}
                    onChange={(e) =>
                      setMetadata({ ...metadata, audience: e.target.value })
                    }
                  >
                    {(
                      selected?.audiences || [
                        { key: "private", label: "개인 보관 · 나만 보기" },
                      ]
                    ).map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {metadata.folder_id && (
                <p className="library-upload-inherit">
                  폴더의 연도와 공개 범위가 적용됩니다.
                </p>
              )}
            </>
          ) : (
            <div className="library-upload-version-target">
              <strong>{target.title}</strong>
              <small>
                현재 v{target.current_version} → v{target.current_version + 1}
              </small>
            </div>
          )}
          <FileDropzone
            file={file}
            extensions={options.extensions}
            disabled={locked}
            onChange={chooseFile}
          />
          {isNew ? (
            <details className="library-upload-extra">
              <summary>
                추가 정보 <span>선택 사항</span>
              </summary>
              <div className="library-upload-extra-fields">
                <div className="library-field-grid">
                  <label>
                    자료 종류
                    <input
                      maxLength={60}
                      placeholder="일반 자료"
                      value={metadata.category}
                      onChange={(e) =>
                        setMetadata({ ...metadata, category: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    행사명
                    <input
                      maxLength={120}
                      value={metadata.event}
                      onChange={(e) =>
                        setMetadata({ ...metadata, event: e.target.value })
                      }
                    />
                  </label>
                </div>
                <label>
                  설명
                  <textarea
                    maxLength={2000}
                    rows={2}
                    value={metadata.description}
                    onChange={(e) =>
                      setMetadata({ ...metadata, description: e.target.value })
                    }
                  />
                </label>
                <label>
                  분류 태그 (기존 폴더 분류)
                  <input
                    maxLength={120}
                    value={metadata.folder}
                    onChange={(e) =>
                      setMetadata({ ...metadata, folder: e.target.value })
                    }
                  />
                </label>
                <label>
                  버전 설명
                  <input
                    maxLength={500}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
              </div>
            </details>
          ) : (
            <label>
              버전 설명
              <input
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="예: 회의 결과 보완"
              />
            </label>
          )}
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {busy && (
          <p role="status">
            파일을 검증하고 저장하고 있습니다. 창을 닫지 마세요.
          </p>
        )}
        <p className="library-upload-safety">
          일반 업무 자료용입니다. 영수증·개인정보는 별도 업무에서 관리하세요.
        </p>
        <div className="dialog-actions library-upload-footer">
          <button type="button" disabled={busy} onClick={onClose}>
            취소
          </button>
          <button
            className="primary"
            disabled={
              busy ||
              !file ||
              (isNew && (!metadata.unit_id || !metadata.title.trim()))
            }
          >
            {busy
              ? "처리 중…"
              : uploadedId
                ? "저장 결과 다시 확인"
                : "파일 등록"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
