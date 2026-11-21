import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import "./documents.css";
import { api } from "../../shared/api";
import { seoulYear } from "../../shared/tenure";
import DocumentDetail from "./DocumentDetail";
import UploadDialog from "./UploadDialog";
import FolderDialog from "./FolderDialog";
import LibraryFiles from "./LibraryFiles";
import StaffScopes from "./StaffScopes";
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

export default function DocumentLibrary({
  time,
  isAdmin,
}: {
  time: string;
  isAdmin: boolean;
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
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const latestRequest = useRef(0),
    latestSelection = useRef(0);
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
      applied.org_id && applied.academic_year && applied.audience !== "all"
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
    setLoading(true);
    setError("");
    setRows([]);
    setFolders([]);
    setDetail(null);
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
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function open(id: string) {
    const request = ++latestSelection.current;
    setDetail(null);
    const row = await api<LibraryDocument & { versions: LibraryVersion[] }>(
      `/documents/${id}`,
    );
    if (request === latestSelection.current) setDetail(row);
  }
  async function changed() {
    const selectedId = detail?.id;
    setDetail(null);
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
    setNotice("");
  }
  function enterOrg(id: string) {
    setGrid(false);
    navigate({
      academic_year: applied.academic_year || seoulYear(time),
      org_id: id,
      audience: "organization",
      folder_id: "root",
    });
  }
  function search(e: FormEvent) {
    e.preventDefault();
    setPage(0);
    setApplied({ ...filters });
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
      ? folders.filter(
          (f) =>
            f.parent_id === (currentFolder?.id || null) &&
            f.name.toLocaleLowerCase().includes(applied.q.toLocaleLowerCase()),
        )
      : [];
  const writable = options.units.filter(
    (u) => !applied.org_id || u.org_id === applied.org_id,
  );
  const years = [
    ...new Set([
      ...(options.years || []),
      Number(seoulYear(time)),
      ...(applied.academic_year ? [Number(applied.academic_year)] : []),
    ]),
  ].sort((a, b) => b - a);
  const uploadOptions = browser ? { ...options, units: writable } : options;
  return (
    <div className="document-library">
      <header className="library-heading">
        <div>
          <span className="library-kicker">OUR SHARED ARCHIVE</span>
          <h2>기록을 이어가는 자료실</h2>
          <p>나의 준비부터 우리의 기록까지, 한곳에서 이어갑니다.</p>
        </div>
        <div className="library-actions">
          <button
            disabled={!writable.length || busy || loading}
            onClick={() => setNewFolder(true)}
          >
            ＋ 새 폴더
          </button>
          <button
            className="primary"
            disabled={!writable.length || busy || loading}
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
      {!browser && (
        <section
          className="library-start"
          aria-label={applied.academic_year ? "단체별 자료실" : "연도별 자료실"}
        >
          <div className="section-heading">
            <h3>
              {applied.academic_year
                ? `${applied.academic_year}년 · 단체별 자료실`
                : "연도별 자료실"}
            </h3>
            {!applied.academic_year && (
              <label className="library-add-year">
                다른 연도
                <input
                  aria-label="열어볼 연도"
                  type="number"
                  min={1900}
                  max={2200}
                  value={filters.academic_year}
                  onChange={(e) =>
                    setFilters({ ...filters, academic_year: e.target.value })
                  }
                  placeholder="예: 2025"
                />
                <button
                  disabled={
                    !filters.academic_year ||
                    Number(filters.academic_year) < 1900 ||
                    Number(filters.academic_year) > 2200
                  }
                  onClick={() =>
                    navigate({ academic_year: filters.academic_year })
                  }
                >
                  열기
                </button>
              </label>
            )}
          </div>
          <div className="library-collection-grid">
            {applied.academic_year
              ? options.organizations.map((o, i) => (
                  <button
                    className="library-collection"
                    key={o.id}
                    onClick={() => enterOrg(o.id)}
                  >
                    <span
                      className={`library-collection-art tone-${i % 3}`}
                      aria-hidden="true"
                    >
                      <b>▱</b>
                      <i>{applied.academic_year}</i>
                    </span>
                    <strong>{o.name}</strong>
                    <small>폴더와 파일 보기 →</small>
                  </button>
                ))
              : years.map((year) => (
                  <button
                    className="library-collection"
                    key={year}
                    onClick={() => navigate({ academic_year: String(year) })}
                  >
                    <span className="library-collection-art" aria-hidden="true">
                      <b>{year}</b>
                      <i>YEONIEUM ARCHIVE</i>
                    </span>
                    <strong>{year}년</strong>
                    <small>
                      {year === Number(seoulYear(time))
                        ? "올해의 기록"
                        : "지난 기록 이어보기"}{" "}
                      →
                    </small>
                  </button>
                ))}
            {!options.organizations.length && applied.academic_year && (
              <p className="muted">
                현재 열람할 단체가 없습니다. 담당 권한을 확인해 주세요.
              </p>
            )}
          </div>
          <p className="library-sharing-note">
            개인 보관은 나만, 단체 공유는 해당 단체 담당자가 봅니다. 연도는 자료
            분류이며 역할 임기와 별개입니다.
          </p>
        </section>
      )}
      <section className="library-workarea">
        {browser && (
          <aside className="library-browser-sidebar" aria-label="자료 보관함">
            <span className="library-kicker">
              {applied.academic_year} ARCHIVE
            </span>
            <h3>{currentOrg?.name}</h3>
            <button
              aria-pressed={!privateMode && applied.trash === "false"}
              onClick={() =>
                navigate({
                  academic_year: applied.academic_year,
                  org_id: applied.org_id,
                  audience: "organization",
                  folder_id: "root",
                })
              }
            >
              <span aria-hidden="true">▱</span> 단체 공유
            </button>
            <button
              aria-pressed={privateMode && applied.trash === "false"}
              onClick={() =>
                navigate({
                  academic_year: applied.academic_year,
                  org_id: applied.org_id,
                  audience: "private",
                  folder_id: "root",
                })
              }
            >
              <span aria-hidden="true">♙</span> 개인 보관
            </button>
            <button
              aria-pressed={applied.trash === "true"}
              onClick={() =>
                navigate({
                  academic_year: applied.academic_year,
                  org_id: applied.org_id,
                  audience: "all",
                  trash: "true",
                })
              }
            >
              <span aria-hidden="true">♧</span> 휴지통
            </button>
            <div className="library-sidebar-note">
              {privateMode
                ? "개인 파일과 폴더는 작성자에게만 표시됩니다."
                : "단체의 공유 자료를 모았습니다. 기존 범위 한정 자료는 허용된 담당자에게만 표시됩니다."}
            </div>
          </aside>
        )}
        <div className="library-main">
          <div className="library-file-heading">
            <div>
              <span className="library-kicker">
                {browser
                  ? privateMode
                    ? "MY FILES"
                    : "TEAM FILES"
                  : "RECENT FILES"}
              </span>
              <h3>
                {applied.trash === "true"
                  ? "휴지통"
                  : currentFolder?.name ||
                    (browser
                      ? privateMode
                        ? "개인 보관"
                        : "단체 공유"
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
                placeholder="제목·설명·파일 이름 검색"
                maxLength={150}
                value={filters.q}
                onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              />
            </label>
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
              onOpen={(id) =>
                void perform(() => open(id), "자료 상세를 열었습니다.")
              }
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
        <aside
          className={`library-inspector ${detail ? "has-selection" : ""}`}
          aria-label="파일 상세 패널"
        >
          {detail ? (
            <DocumentDetail
              key={`${detail.id}-${detail.revision}`}
              row={detail}
              versions={detail.versions}
              options={options}
              busy={busy}
              onClose={() => setDetail(null)}
              onVersion={() => setUpload(detail)}
              onChanged={changed}
              perform={perform}
            />
          ) : (
            <div className="library-inspector-empty">
              <span aria-hidden="true">▤</span>
              <strong>기록을 펼쳐보세요</strong>
              <p>
                파일을 선택하면 정보와
                <br />
                이전 버전을 확인할 수 있습니다.
              </p>
            </div>
          )}
        </aside>
      </section>
      {upload && (
        <UploadDialog
          target={upload}
          options={uploadOptions}
          time={time}
          folderName={currentFolder?.name}
          defaults={{
            academic_year: Number(applied.academic_year || seoulYear(time)),
            unit_id: writable[0]?.id || "",
            audience:
              currentFolder?.audience ||
              (browser && !privateMode ? "organization" : "private"),
            folder_id: currentFolder?.id || null,
          }}
          onClose={() => setUpload(null)}
          onSaved={async (id) => {
            await refresh();
            await open(id);
            setNotice("파일을 등록했습니다. 이전 버전은 보존됩니다.");
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
