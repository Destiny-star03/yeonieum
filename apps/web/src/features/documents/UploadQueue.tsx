import { fileSize } from "./api";

export type QueuedUpload = {
  key: number;
  file: File;
  title: string;
  sessionId?: string;
  resultId?: string;
  error?: string;
};

export default function UploadQueue({
  entries,
  processing,
  locked,
  busy,
  onTitle,
  onRemove,
}: {
  entries: QueuedUpload[];
  processing: number | null;
  locked: boolean;
  busy: boolean;
  onTitle: (key: number, title: string) => void;
  onRemove: (key: number) => void;
}) {
  if (!entries.length) return null;
  return (
    <ul className="library-upload-queue" aria-label="등록할 파일">
      {entries.map((entry) => (
        <li className="library-selected-file" key={entry.key}>
          <div>
            <strong>{entry.file.name}</strong>
            <small role="status">
              {fileSize(entry.file.size)} ·{" "}
              {entry.resultId
                ? "등록됨"
                : entry.key === processing
                  ? "등록 중…"
                  : entry.error
                    ? "등록 실패"
                    : "선택됨"}
            </small>
            {entries.length > 1 && (
              <label>
                제목
                <input
                  aria-label={`${entry.file.name} 제목`}
                  required
                  maxLength={150}
                  value={entry.title}
                  disabled={locked}
                  onChange={(event) => onTitle(entry.key, event.target.value)}
                />
              </label>
            )}
            {entry.error && (
              <small className="library-queue-error">{entry.error}</small>
            )}
          </div>
          {!entry.resultId && (
            <button
              type="button"
              aria-label={
                entries.length === 1
                  ? "선택한 파일 제거"
                  : `${entry.file.name} 제거`
              }
              disabled={busy}
              onClick={() => onRemove(entry.key)}
            >
              ✕
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
