import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import "./documents.css";
import { api } from "../../shared/api";
import { seoulYear } from "../../shared/tenure";
import DocumentDetail from "./DocumentDetail";
import DocumentViewer from "./DocumentViewer";
import LibraryNavigation from "./LibraryNavigation";
import UploadDialog from "./UploadDialog";
import FolderDialog from "./FolderDialog";
import LibraryFiles from "./LibraryFiles";
import StaffScopes from "./StaffScopes";
import type { NotificationTarget } from "../notifications/NotificationBell";
import {
  type LibraryDocument,
  type LibraryFolder,
  type LibraryOptions,
  type LibraryVersion,
} from "./api";

type Filters = {
  q: string;
  org_id: string;
  academic_year: string;
  category: string;
  folder: string;
  event: string;
  trash: string;
  audience: string;
  folder_id: string;
  file_type: string;
  sort: string;
  descending: string;
};
const initial: Filters = {
  q: "",
  org_id: "",
  academic_year: "",
  category: "",
  folder: "",
  event: "",
  trash: "false",
  audience: "all",
  folder_id: "",
  file_type: "",
  sort: "updated",
  descending: "true",
};
const fileTypes = [
  ["", "전체"],
  ["pdf", "PDF"],
  ["text", "TXT·CSV"],
  ["document", "DOC·HWP"],
  ["slides", "PPT"],
  ["sheet", "XLS"],
  ["image", "이미지"],
];
const fileDragType = "application/x-yeonieum-document";

export default function DocumentLibrary({
  time,
  isAdmin,
  notification,
}: {
  time: string;
  isAdmin: boolean;
  notification: Extract<NotificationTarget, { kind: "document" }> | null;
}) {
  const [options, setOptions] = useState<LibraryOptions>({
    units: [],
    organizations: [],
    extensions: [],
    max_size: 0,
  });
  const [filters, setFilters] = useState(initial),
    [applied, setApplied] = useState(initial);
  const [rows, setRows] = useState<LibraryDocument[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(0);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [detail, setDetail] = useState<
    (LibraryDocument & { versions: LibraryVersion[] }) | null
  >(null);
  const [upload, setUpload] = useState<LibraryDocument | "new" | null>(null),
    [newFolder, setNewFolder] = useState(false);
  const [grid, setGrid] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [searchHere, setSearchHere] = useState(false);
  const [draggedFile, setDraggedFile] = useState<LibraryDocument | null>(null);
  const [activeDropTarget, setActiveDropTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const latestRequest = useRef(0),
    latestSelection = useRef(0);
  const latestRefresh = useRef<() => Promise<void>>(async () => {});
  const detailPanel = useRef<HTMLElement>(null);
  const browser = Boolean(applied.org_id),
    privateMode = applied.audience === "private";
  const currentFolder = folders.find((f) => f.id === applied.folder_id) || null;
  const currentOrg = options.organizations.find((o) => o.id === applied.org_id);
  const refresh = useCallback(async () => {
    const requestId = ++latestRequest.current;
    const params = new URLSearchParams(
      Object.entries(applied).filter(([, v]) => v),
    );
    params.set("offset", String(page * 20));
    const [data, available, directories] = await Promise.all([
      api<{ items: LibraryDocument[]; total: number }>(`/documents?${params}`),
      api<LibraryOptions>("/documents/options"),
      applied.academic_year && applied.trash === "false"
        ? api<LibraryFolder[]>(
            `/documents/folders?${new URLSearchParams({ org_id: applied.org_id, academic_year: applied.academic_year, audience: applied.audience })}`,
          )
        : Promise.resolve([] as LibraryFolder[]),
    ]);
    if (requestId !== latestRequest.current) return;
    const lastPage = Math.max(0, Math.ceil(data.total / 20) - 1);
    if (page > lastPage) {
      setPage(lastPage);
      return;
    }
    setRows(data.items);
    setTotal(data.total);
    setOptions(available);
    setFolders(directories);
  }, [applied, page]);
  useEffect(() => {
    let alive = true;
    latestRefresh.current = refresh;
    setLoading(true);
    setError("");
    setRows([]);
    setFolders([]);
    setDetail(null);
    setPreviewOpen(false);
    latestSelection.current++;
    refresh()
      .catch((e: Error) => {
        if (alive) {
          setRows([]);
          setTotal(0);
          setError(e.message);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      latestRequest.current++;
    };
  }, [refresh]);
  async function perform(action: () => Promise<void>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (message) setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function open(id: string, preview = false) {
    const request = ++latestSelection.current;
    setDetail(null);
    const row = await api<LibraryDocument & { versions: LibraryVersion[] }>(
      `/documents/${id}`,
    );
    if (request === latestSelection.current) {
      setDetail(row);
      setPreviewOpen(preview && !row.deleted_at);
    }
  }
  useEffect(() => {
    if (notification) void perform(() => open(notification.id, true), "");
  }, [notification]);
  async function changed() {
    const selectedId = detail?.id;
    setDetail(null);
    setPreviewOpen(false);
    setRows([]);
    await refresh();
    if (selectedId) {
      try {
        await open(selectedId);
      } catch {
        setDetail(null);
      }
    }
  }
  function navigate(next: Partial<Filters>) {
    const updated = { ...initial, ...next };
    setFilters(updated);
    setApplied(updated);
    setPage(0);
    setDetail(null);
    setPreviewOpen(false);
    setSearchHere(false);
    setNotice("");
  }
  function enterOrg(id: string) {
    setGrid(false);
    const personalOnly =
      options.units.some((u) => u.org_id === id) &&
      !options.units.some(
        (u) =>
          u.org_id === id && u.audiences.some((a) => a.key === "organization"),
      );
    navigate({
      academic_year: applied.academic_year || seoulYear(time),
      org_id: id,
      audience: personalOnly ? "private" : "organization",
      folder_id: "root",
    });
  }
  function visitMode(mode: "recent" | "private" | "organization" | "trash") {
    if (mode === "recent") {
      setGrid(true);
      navigate({});
      return;
    }
    navigate({
      academic_year: applied.academic_year,
      org_id: applied.org_id,
      audience: mode === "trash" ? "all" : mode,
      trash: mode === "trash" ? "true" : "false",
      folder_id: browser && mode !== "trash" ? "root" : "",
    });
  }
  function search(e: FormEvent) {
    e.preventDefault();
    setPage(0);
    const q = filters.q.trim();
    const acrossYear = q && !searchHere && filters.trash !== "true";
    const next = acrossYear
      ? {
          ...filters,
          q,
          folder_id: "",
          org_id: filters.org_id === applied.org_id ? "" : filters.org_id,
          audience: privateMode ? "private" : "all",
        }
      : { ...filters, q };
    setFilters(next);
    setApplied(next);
  }
  const crumbs: LibraryFolder[] = [];
  for (
    let f = currentFolder;
    f && !crumbs.some((c) => c.id === f!.id);
    f = folders.find((p) => p.id === f!.parent_id) || null
  )
    crumbs.unshift(f);
  const visibleFolders =
    applied.trash === "false"
      ? folders.filter((f) =>
          applied.q && !applied.folder_id
            ? f.name.toLocaleLowerCase().includes(applied.q.toLocaleLowerCase())
            : f.parent_id === (currentFolder?.id || null) &&
              f.name
                .toLocaleLowerCase()
                .includes(applied.q.toLocaleLowerCase()),
        )
      : [];
  function canMoveTo(row: LibraryDocument, folder: LibraryFolder | null) {
    const folderId = folder?.id || "root";
    return (
      row.can_move &&
      (row.folder_id || "root") !== folderId &&
      row.org_id === (folder?.org_id || applied.org_id) &&
      row.academic_year ===
        (folder?.academic_year ?? Number(applied.academic_year)) &&
      row.audience === (folder?.audience || applied.audience)
    );
  }
  function endFileDrag() {
    setDraggedFile(null);
    setActiveDropTarget(null);
  }
  async function moveFile(row: LibraryDocument, folder: LibraryFolder | null) {
    if (busy || loading || !canMoveTo(row, folder)) return;
    const requestId = latestRequest.current;
    await perform(
      async () => {
        await api(`/documents/${row.id}/move`, {
          folder_id: folder?.id ?? null,
          expected_revision: row.revision,
        });
        if (requestId === latestRequest.current) {
          setDetail((selected) => (selected?.id === row.id ? null : selected));
          if (applied.folder_id && rows.some((file) => file.id === row.id)) {
            setRows((files) => files.filter((file) => file.id !== row.id));
            setTotal((count) => Math.max(0, count - 1));
          }
        }
        try {
          await latestRefresh.current();
        } catch {
          setError("자료 목록을 갱신하지 못했습니다. 새로고침해 주세요.");
        }
      },
      `‘${row.title}’ 자료를 ${folder ? `‘${folder.name}’ 폴더` : "최상위"}로 이동했습니다.`,
    );
  }
  function fileDragProps(row: LibraryDocument) {
    if (
      busy ||
      loading ||
      ![null, ...crumbs, ...visibleFolders].some((folder) =>
        canMoveTo(row, folder),
      )
    )
      return;
    return {
      draggable: true,
      onDragStart: (event: DragEvent<HTMLButtonElement>) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(fileDragType, row.id);
        setDraggedFile(row);
      },
      onDragEnd: endFileDrag,
    };
  }
  function folderDropProps(folder: LibraryFolder | null) {
    if (busy || loading || !draggedFile || !canMoveTo(draggedFile, folder))
      return;
    const target = folder?.id || "root";
    return {
      "data-drop-state": activeDropTarget === target ? "active" : "available",
      onDragOver: (event: DragEvent<HTMLButtonElement>) => {
        if (!event.dataTransfer.types.includes(fileDragType)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setActiveDropTarget(target);
      },
      onDragLeave: (event: DragEvent<HTMLButtonElement>) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        )
          return;
        setActiveDropTarget((active) => (active === target ? null : active));
      },
      onDrop: (event: DragEvent<HTMLButtonElement>) => {
        if (event.dataTransfer.getData(fileDragType) !== draggedFile.id) return;
        event.preventDefault();
        endFileDrag();
        void moveFile(draggedFile, folder);
      },
    };
  }
  function folderPath(folder: LibraryFolder) {
    const names = [folder.name];
    let parentId = folder.parent_id;
    while (parentId && names.length <= folders.length) {
      const parent = folders.find((entry) => entry.id === parentId);
      if (!parent) break;
      names.unshift(parent.name);
      parentId = parent.parent_id;
    }
    return names.join(" / ");
  }
  const writable = options.units.filter(
    (u) => !applied.org_id || u.org_id === applied.org_id,
  );
  const folderWritable = currentFolder
    ? writable.filter((unit) =>
        unit.audiences.some((a) => a.key === currentFolder.audience),
      )
    : writable;
  const uploadUnits = folderWritable.length ? folderWritable : options.units;
  const uploadFolder = folderWritable.length ? currentFolder : null;
  const uploadUnit =
    uploadUnits.find(
      (unit) =>
        browser &&
        !privateMode &&
        unit.audiences.some((a) => a.key === "organization"),
    ) || uploadUnits[0];
  const years = [
    ...new Set([
      ...(options.years || []),
      Number(seoulYear(time)),
      ...(applied.academic_year ? [Number(applied.academic_year)] : []),
    ]),
  ].sort((a, b) => b - a);
  const uploadOptions = { ...options, units: uploadUnits };
  const currentVersion = detail?.versions.find(
    (version) => version.version === detail.current_version,
  );
  return (
    <div className="document-library">
      <header className="library-heading">
        <h1>자료실</h1>
        <div className="library-actions">
          <button
            disabled={!writable.length || busy || loading}
            onClick={() => setNewFolder(true)}
          >
            ＋ 새 폴더
          </button>
          <button
            className="primary"
            disabled={!options.units.length || busy || loading}
            onClick={() => setUpload("new")}
          >
            ＋ 자료 등록
          </button>
        </div>
      </header>
      {isAdmin && <StaffScopes onChanged={changed} />}
      <nav className="library-breadcrumbs" aria-label="자료실 경로">
        <button onClick={() => navigate({})}>자료실</button>
        {applied.academic_year && (
          <>
            <span>›</span>
            <button
              onClick={() => navigate({ academic_year: applied.academic_year })}
            >
              {applied.academic_year}년
            </button>
          </>
        )}
        {browser && (
          <>
            <span>›</span>
            <button onClick={() => enterOrg(applied.org_id)}>
              {currentOrg?.name || "단체"}
            </button>
            <span>›</span>
            <button
              {...folderDropProps(null)}
              onClick={() =>
                navigate({
                  academic_year: applied.academic_year,
                  org_id: applied.org_id,
                  audience: applied.audience,
                  folder_id: "root",
                })
              }
            >
              {privateMode ? "개인 보관" : "단체 공유"}
            </button>
          </>
        )}
        {crumbs.map((f) => (
          <span className="library-crumb" key={f.id}>
            <span>›</span>
            <button
              {...folderDropProps(f)}
              onClick={() =>
                navigate({
                  academic_year: applied.academic_year,
                  org_id: applied.org_id,
                  audience: applied.audience,
                  folder_id: f.id,
                })
              }
            >
              {f.name}
            </button>
          </span>
        ))}
      </nav>
      <section className="library-workarea">
        <LibraryNavigation
          years={years}
          year={applied.academic_year}
          org={applied.org_id}
          mode={
            applied.trash === "true"
              ? "trash"
              : privateMode
                ? "private"
                : browser
                  ? "organization"
                  : applied.academic_year
                    ? "year"
                    : "recent"
          }
          organizations={options.organizations}
          onYear={(year) => navigate({ academic_year: year })}
          onOrg={enterOrg}
          onMode={visitMode}
        />
        <div className="library-main">
          <div className="library-file-heading">
            <div>
              <h3>
                {applied.trash === "true"
                  ? "휴지통"
                  : applied.q
                    ? "검색 결과"
                    : currentFolder?.name ||
                      (privateMode
                        ? "개인 보관"
                        : browser
                          ? "단체 공유"
                          : applied.academic_year
                            ? `${applied.academic_year}년 자료`
                            : "최근 자료")}{" "}
                <span className="count">{total}</span>
              </h3>
            </div>
            <div className="library-view-buttons">
              <button
                aria-label="카드 보기"
                aria-pressed={grid}
                onClick={() => setGrid(true)}
              >
                ▦
              </button>
              <button
                aria-label="목록 보기"
                aria-pressed={!grid}
                onClick={() => setGrid(false)}
              >
                ☷
              </button>
              <button
                aria-label="자료 새로고침"
                disabled={busy || loading}
                onClick={() =>
                  void perform(changed, "자료 목록을 새로 확인했습니다.")
                }
              >
                ↻
              </button>
            </div>
          </div>
          <form className="library-search-form" onSubmit={search}>
            <label className="library-search-input">
              <span aria-hidden="true">⌕</span>
              <input
                aria-label="자료 검색"
                placeholder={
                  applied.academic_year
                    ? `${applied.academic_year}년 자료 검색`
                    : "제목·파일명·폴더 검색"
                }
                maxLength={150}
                value={filters.q}
                onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              />
            </label>
            {browser && applied.trash === "false" && (
              <select
                aria-label="검색 범위"
                value={searchHere ? "location" : "year"}
                onChange={(event) =>
                  setSearchHere(event.target.value === "location")
                }
              >
                <option value="year">이 연도 전체</option>
                <option value="location">현재 위치</option>
              </select>
            )}
            <button disabled={loading || busy}>검색 적용</button>
            <details className="library-advanced">
              <summary>상세 검색</summary>
              <div className="library-filters">
                <label>
                  자료함
                  <select
                    value={filters.trash}
                    onChange={(e) =>
                      setFilters({ ...filters, trash: e.target.value })
                    }
                  >
                    <option value="false">보관 자료</option>
                    <option value="true">휴지통</option>
                  </select>
                </label>
                <label>
                  학년도 필터
                  <input
                    type="number"
                    min={1900}
                    max={2200}
                    value={filters.academic_year}
                    onChange={(e) =>
                      setFilters({ ...filters, academic_year: e.target.value })
                    }
                    placeholder="전체"
                  />
                </label>
                <label>
                  단체 필터
                  <select
                    value={filters.org_id}
                    onChange={(e) =>
                      setFilters({
                        ...filters,
                        org_id: e.target.value,
                        folder_id: "",
                      })
                    }
                  >
                    <option value="">전체 열람 범위</option>
                    {options.organizations.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
                {(
                  [
                    ["category", "자료 종류 필터"],
                    ["folder", "폴더 필터"],
                    ["event", "행사 필터"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      maxLength={120}
                      value={filters[key]}
                      onChange={(e) =>
                        setFilters({ ...filters, [key]: e.target.value })
                      }
                      placeholder="전체"
                    />
                  </label>
                ))}
                <button type="button" onClick={() => navigate({})}>
                  초기화
                </button>
              </div>
            </details>
          </form>
          <div className="library-list-toolbar">
            <div className="library-type-chips" aria-label="파일 형식 필터">
              {fileTypes.map(([key, label]) => (
                <button
                  key={key}
                  aria-pressed={applied.file_type === key}
                  onClick={() => {
                    setPage(0);
                    setFilters({ ...filters, file_type: key });
                    setApplied({ ...applied, file_type: key });
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="library-sort">
              정렬
              <select
                aria-label="자료 정렬"
                value={applied.sort}
                onChange={(e) => {
                  setPage(0);
                  setFilters({ ...filters, sort: e.target.value });
                  setApplied({ ...applied, sort: e.target.value });
                }}
              >
                <option value="updated">수정 날짜</option>
                <option value="name">이름</option>
                <option value="size">크기</option>
              </select>
            </label>
            <button
              className="library-sort-direction"
              aria-label={
                applied.descending === "true"
                  ? "오름차순으로 정렬"
                  : "내림차순으로 정렬"
              }
              onClick={() => {
                const descending =
                  applied.descending === "true" ? "false" : "true";
                setPage(0);
                setFilters({ ...filters, descending });
                setApplied({ ...applied, descending });
              }}
            >
              {applied.descending === "true" ? "↓" : "↑"}
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="success" role="status">
              {notice}
            </p>
          )}
          {loading ? (
            <p className="library-empty" role="status">
              자료를 불러오고 있습니다…
            </p>
          ) : (
            <LibraryFiles
              rows={rows}
              folders={visibleFolders}
              grid={grid}
              selected={detail?.id}
              busy={busy}
              fileDragProps={fileDragProps}
              folderDropProps={folderDropProps}
              folderSubtitle={(folder) =>
                browser
                  ? applied.q
                    ? folderPath(folder)
                    : ""
                  : `${options.organizations.find((o) => o.id === folder.org_id)?.name || ""} · ${folder.parent_id ? folderPath(folder) : folder.audience === "private" ? "개인 보관" : "단체 공유"}`
              }
              onOpen={(id) => void perform(() => open(id, true), "")}
              onFolder={(f) => {
                setGrid(false);
                navigate({
                  academic_year: String(f.academic_year),
                  org_id: f.org_id,
                  audience: f.audience,
                  folder_id: f.id,
                });
              }}
            />
          )}
          {!loading && !rows.length && !visibleFolders.length && (
            <div className="library-empty">
              <span aria-hidden="true">▱</span>
              <h3>
                {applied.trash === "true"
                  ? "휴지통이 비어 있습니다"
                  : "아직 자료가 없습니다"}
              </h3>
              <p>
                {applied.q || applied.file_type
                  ? "검색 조건을 바꾸어 다시 찾아보세요."
                  : "새 폴더를 만들거나 첫 파일을 등록해 보세요."}
              </p>
            </div>
          )}
          <div className="library-pagination">
            <button
              disabled={!page || loading}
              onClick={() => setPage(page - 1)}
            >
              이전
            </button>
            <span>
              {page + 1} / {Math.max(1, Math.ceil(total / 20))}
            </span>
            <button
              disabled={(page + 1) * 20 >= total || loading}
              onClick={() => setPage(page + 1)}
            >
              다음
            </button>
          </div>
        </div>
        {detail && (
          <aside
            className="library-inspector has-selection"
            aria-label="파일 상세 패널"
            ref={detailPanel}
            tabIndex={-1}
          >
            <DocumentDetail
              key={`${detail.id}-${detail.revision}`}
              row={detail}
              versions={detail.versions}
              options={options}
              busy={busy}
              onClose={() => setDetail(null)}
              onPreview={() => setPreviewOpen(true)}
              onVersion={() => setUpload(detail)}
              moveDestinations={[null, ...folders]
                .filter((folder) => canMoveTo(detail, folder))
                .map((folder) => ({
                  id: folder?.id || "root",
                  label: folder ? folderPath(folder) : "최상위",
                }))}
              onMove={(id) => {
                const target = folders.find((folder) => folder.id === id);
                if (id === "root" || target)
                  void moveFile(detail, target ?? null);
              }}
              onChanged={changed}
              perform={perform}
            />
          </aside>
        )}
      </section>
      {previewOpen && detail && currentVersion && !detail.deleted_at && (
        <DocumentViewer
          key={`${detail.id}-${detail.current_version}`}
          row={detail}
          version={currentVersion}
          onClose={() => setPreviewOpen(false)}
          onDetails={() => {
            setPreviewOpen(false);
            window.requestAnimationFrame(() => detailPanel.current?.focus());
          }}
        />
      )}
      {upload && (
        <UploadDialog
          target={upload}
          options={uploadOptions}
          time={time}
          folderName={uploadFolder?.name}
          defaults={{
            academic_year: Number(applied.academic_year || seoulYear(time)),
            unit_id: uploadUnit?.id || "",
            audience:
              uploadFolder?.audience ||
              (browser &&
              !privateMode &&
              uploadUnit?.org_id === applied.org_id &&
              uploadUnit.audiences.some((a) => a.key === "organization")
                ? "organization"
                : "private"),
            folder_id: uploadFolder?.id || null,
          }}
          onClose={() => setUpload(null)}
          onSaved={async (ids) => {
            await refresh();
            if (ids.length === 1) await open(ids[0]);
            setNotice(`${ids.length}개 파일을 등록했습니다.`);
          }}
        />
      )}
      {newFolder && (
        <FolderDialog
          options={options}
          year={Number(applied.academic_year || seoulYear(time))}
          org={applied.org_id}
          audience={privateMode ? "private" : "organization"}
          parent={currentFolder}
          onClose={() => setNewFolder(false)}
          onSaved={async (f) => {
            await refresh();
            setGrid(false);
            navigate({
              academic_year: String(f.academic_year),
              org_id: f.org_id,
              audience: f.audience,
              folder_id: f.id,
            });
          }}
        />
      )}
    </div>
  );
}
