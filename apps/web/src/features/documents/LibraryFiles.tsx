import { useEffect, useState, type ButtonHTMLAttributes } from "react";
import { formatDate } from "../../shared/tenure";
import { fileSize, type LibraryDocument, type LibraryFolder } from "./api";

function FileCover({ row, grid }: { row: LibraryDocument; grid: boolean }) {
  const extension = row.filename.split(".").pop()?.toUpperCase() || "FILE";
  const url = `/api/documents/${row.id}/versions/${row.current_version}/preview`;
  const textFile = extension === "TXT" || extension === "CSV";
  const showExcerpt = grid && textFile && !row.deleted_at;
  const [excerpt, setExcerpt] = useState("");
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    if (!showExcerpt) return;
    const request = new AbortController();
    void fetch(url, { signal: request.signal })
      .then(async (response) => {
        if (
          response.ok &&
          response.headers.get("Content-Type")?.startsWith("text/plain")
        ) {
          const text = await response.text();
          if (!request.signal.aborted) setExcerpt(text);
        }
      })
      .catch(() => {});
    return () => request.abort();
  }, [showExcerpt, url]);
  return (
    <span
      className={`library-cover${imageLoaded ? " has-image" : ""}`}
      aria-hidden="true"
    >
      {!imageLoaded && (
        <span className="library-cover-paper">
          <b>{extension}</b>
          {showExcerpt && excerpt ? (
            <span className="library-cover-excerpt">{excerpt}</span>
          ) : (
            <>
              <i />
              <i />
              <i />
              <i />
              <i />
            </>
          )}
        </span>
      )}
      {!row.deleted_at && !textFile && !imageFailed && (
        <img
          className="library-cover-image"
          src={url}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageFailed(true)}
        />
      )}
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
  fileDragProps,
  folderDropProps,
  folderSubtitle,
}: {
  rows: LibraryDocument[];
  folders: LibraryFolder[];
  grid: boolean;
  selected?: string;
  busy: boolean;
  onOpen: (id: string) => void;
  onFolder: (folder: LibraryFolder) => void;
  folderSubtitle: (folder: LibraryFolder) => string;
  fileDragProps: (
    row: LibraryDocument,
  ) =>
    | Pick<
        ButtonHTMLAttributes<HTMLButtonElement>,
        "draggable" | "onDragStart" | "onDragEnd"
      >
    | undefined;
  folderDropProps: (
    folder: LibraryFolder,
  ) =>
    | (Pick<
        ButtonHTMLAttributes<HTMLButtonElement>,
        "onDragOver" | "onDragLeave" | "onDrop"
      > & { "data-drop-state": string })
    | undefined;
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
              {...folderDropProps(f)}
            >
              <span className="library-folder-symbol" aria-hidden="true">
                ▱
              </span>
              <span>
                <strong>{f.name}</strong>
                <small>
                  {folderSubtitle(f) ||
                    (f.audience === "private" ? "나만 보기" : "단체 공유")}
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
              {...fileDragProps(row)}
            >
              <FileCover key={row.current_version} row={row} grid={grid} />
              <span className="library-file-caption">
                <strong>{row.title}</strong>
                <small>
                  {row.org_name} · {row.academic_year}년
                  {row.folder_name ? ` · ${row.folder_name}` : ""}
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
