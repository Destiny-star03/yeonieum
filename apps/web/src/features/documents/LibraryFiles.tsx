import { formatDate } from "../../shared/tenure";
import { fileSize, type LibraryDocument, type LibraryFolder } from "./api";

export function FileCover({ row }: { row: LibraryDocument }) {
  const extension = row.filename.split(".").pop()?.toUpperCase() || "FILE";
  return (
    <span
      className={`library-cover library-cover-${extension.toLowerCase()}`}
      aria-hidden="true"
    >
      <span className="library-cover-paper">
        <b>{extension}</b>
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}

export default function LibraryFiles({
  rows,
  folders,
  grid,
  selected,
  busy,
  onOpen,
  onFolder,
}: {
  rows: LibraryDocument[];
  folders: LibraryFolder[];
  grid: boolean;
  selected?: string;
  busy: boolean;
  onOpen: (id: string) => void;
  onFolder: (folder: LibraryFolder) => void;
}) {
  return (
    <>
      {folders.length > 0 && (
        <div className="library-folder-grid" aria-label="폴더 목록">
          {folders.map((f) => (
            <button
              className="library-folder-card"
              key={f.id}
              disabled={busy}
              onClick={() => onFolder(f)}
              aria-label={`${f.name} 폴더 열기`}
            >
              <span className="library-folder-symbol" aria-hidden="true">
                ▱
              </span>
              <span>
                <strong>{f.name}</strong>
                <small>
                  {f.audience === "private" ? "나만 보기" : "단체 공유"}
                </small>
              </span>
              <span aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      )}
      <ul
        className={`library-list ${grid ? "library-card-grid" : "library-file-rows"}`}
      >
        {rows.map((row) => (
          <li key={row.id}>
            <button
              className={`library-document ${selected === row.id ? "is-selected" : ""}`}
              disabled={busy}
              onClick={() => onOpen(row.id)}
              aria-label={`${row.title} 자료 열기`}
            >
              <FileCover row={row} />
              <span className="library-file-caption">
                <strong>{row.title}</strong>
                <small>
                  {row.org_name} · {row.academic_year}년
                </small>
                <small>
                  {row.audience === "private"
                    ? "나만 보기"
                    : row.audience === "organization"
                      ? "단체 공유"
                      : "범위 한정 공유"}{" "}
                  · {formatDate(row.updated_at)}
                </small>
                <small className="library-file-original">
                  {row.filename} · v{row.current_version}
                </small>
              </span>
              <span className="library-file-size">{fileSize(row.size)}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
