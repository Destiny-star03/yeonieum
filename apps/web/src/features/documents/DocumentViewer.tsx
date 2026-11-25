import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type UIEvent,
} from "react";
import { downloadFile, type LibraryDocument, type LibraryVersion } from "./api";
import { api } from "../../shared/api";

type ReaderContent =
  | { kind: "pages"; page_count: number }
  | { kind: "text"; text: string; truncated: boolean }
  | { kind: "unavailable" };

function ReaderPage({
  src,
  label,
  zoomed = false,
  fallback,
  lazy = false,
}: {
  src: string;
  label: string;
  zoomed?: boolean;
  fallback?: string;
  lazy?: boolean;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  return (
    <div className={`library-reader-page${zoomed ? " is-zoomed" : ""}`}>
      {status !== "error" && (
        <img
          src={src}
          alt={label}
          draggable={false}
          loading={lazy ? "lazy" : "eager"}
          onLoad={() => setStatus("ready")}
          onError={() => setStatus("error")}
        />
      )}
      {status === "loading" && <p>페이지를 불러오는 중…</p>}
      {status === "error" && (
        <p role="status">{fallback || "이 페이지를 표시할 수 없습니다."}</p>
      )}
    </div>
  );
}

export default function DocumentViewer({
  row,
  version,
  onClose,
  onDetails,
}: {
  row: LibraryDocument;
  version: LibraryVersion;
  onClose: () => void;
  onDetails: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const reader = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    top: number;
    left: number;
  } | null>(null);
  const zoomAnchor = useRef<number | null>(null);
  const [content, setContent] = useState<ReaderContent | null>(null);
  const [page, setPage] = useState(1);
  const [zoomed, setZoomed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const versionUrl = `/documents/${row.id}/versions/${version.version}`;
  const url = `${versionUrl}/read`;
  const canPan =
    content?.kind === "pages" && (content.page_count > 1 || zoomed);
  const showPage = useCallback((number: number) => {
    const body = reader.current;
    const target = body?.children[number - 1];
    if (body && target instanceof HTMLElement) {
      body.scrollTop = target.offsetTop;
      setPage(number);
    }
  }, []);

  useLayoutEffect(() => {
    if (zoomAnchor.current !== null) {
      showPage(zoomAnchor.current);
      zoomAnchor.current = null;
    }
  }, [showPage, zoomed]);

  function trackPage(event: UIEvent<HTMLDivElement>) {
    if (content?.kind !== "pages" || content.page_count <= 1) return;
    const { children, scrollTop, clientHeight } = event.currentTarget;
    const center = scrollTop + clientHeight / 2;
    let first = 0;
    let last = children.length;
    while (first < last) {
      const middle = Math.floor((first + last) / 2);
      if ((children[middle] as HTMLElement).offsetTop <= center)
        first = middle + 1;
      else last = middle;
    }
    setPage(Math.max(1, first));
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    const body = event.currentTarget;
    if (
      !canPan ||
      event.pointerType !== "mouse" ||
      event.button !== 0 ||
      event.target === body
    )
      return;
    event.preventDefault();
    body.focus({ preventScroll: true });
    body.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      top: body.scrollTop,
      left: body.scrollLeft,
    };
    setDragging(true);
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (start?.pointerId !== event.pointerId) return;
    event.currentTarget.scrollTop = start.top + start.y - event.clientY;
    event.currentTarget.scrollLeft = start.left + start.x - event.clientX;
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
  }

  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    let active = true;
    void api<ReaderContent>(url)
      .then((result) => {
        if (active) setContent(result);
      })
      .catch((reason: Error) => {
        if (active) {
          setContent({ kind: "unavailable" });
          setError(reason.message);
        }
      });
    return () => {
      active = false;
    };
  }, [url]);

  async function download() {
    setError("");
    setDownloading(true);
    try {
      await downloadFile(row.id, version);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="library-viewer"
      aria-labelledby="library-viewer-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="library-viewer-layout">
        <header className="library-viewer-toolbar">
          <button
            type="button"
            aria-label="미리보기 닫기"
            onClick={onClose}
            autoFocus
          >
            ×
          </button>
          <h2 id="library-viewer-title">
            {row.title}
            <small>미리보기 · v{version.version}</small>
          </h2>
          <button type="button" onClick={onDetails}>
            파일 정보
          </button>
          <button
            type="button"
            disabled={downloading}
            onClick={() => void download()}
          >
            다운로드
          </button>
        </header>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div
          ref={reader}
          className={`library-reader-body${canPan ? " can-pan" : ""}${dragging ? " is-dragging" : ""}`}
          tabIndex={0}
          role="region"
          aria-label="파일 내용"
          onScroll={trackPage}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onLostPointerCapture={finishDrag}
        >
          {!content && <p role="status">파일을 불러오는 중…</p>}
          {content?.kind === "pages" &&
            Array.from({ length: content.page_count }, (_, index) => (
              <ReaderPage
                key={index + 1}
                src={`/api${url}/pages/${index + 1}`}
                label={`${index + 1}페이지`}
                zoomed={zoomed}
                lazy={index > 0}
              />
            ))}
          {content?.kind === "text" && (
            <article className="library-reader-text">
              <pre>{content.text || "표시할 텍스트가 없습니다."}</pre>
              {content.truncated && (
                <p>
                  미리보기 분량을 넘는 내용은 다운로드에서 확인할 수 있습니다.
                </p>
              )}
            </article>
          )}
          {content?.kind === "unavailable" && !error && (
            <ReaderPage
              src={`/api${versionUrl}/preview`}
              label="파일 표지"
              fallback="이 파일은 다운로드해서 열 수 있습니다."
            />
          )}
        </div>
        {content?.kind === "pages" && (
          <footer className="library-viewer-controls">
            {content.page_count > 1 && (
              <>
                <button
                  type="button"
                  disabled={page === 1}
                  onClick={() => showPage(page - 1)}
                >
                  이전 페이지
                </button>
                <span aria-live="polite">
                  {page} / {content.page_count}
                </span>
                <button
                  type="button"
                  disabled={page === content.page_count}
                  onClick={() => showPage(page + 1)}
                >
                  다음 페이지
                </button>
              </>
            )}
            <button
              type="button"
              aria-pressed={zoomed}
              onClick={() => {
                zoomAnchor.current = page;
                setZoomed(!zoomed);
              }}
            >
              {zoomed ? "화면 맞춤" : "확대"}
            </button>
          </footer>
        )}
      </div>
    </dialog>
  );
}
