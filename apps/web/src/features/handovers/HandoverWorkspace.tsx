import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { api } from "../../shared/api";
import "./handovers.css";

type User = { id: string; name: string; is_admin?: number };
type Item = {
  id: string;
  kind: string;
  reference_id: string | null;
  title: string;
  required: number;
  checked_at: string | null;
  checked_by: string | null;
};
type Handover = {
  id: string;
  org_id: string;
  year: number;
  title: string;
  from_user_id: string;
  from_name: string;
  to_user_id: string;
  to_name: string;
  completed_at: string | null;
  revision: number;
  items: Item[];
};
type Options = {
  organizations: { id: string; name: string }[];
  people: Record<string, { id: string; name: string }[]>;
};
type References = {
  documents: { id: string; title: string }[];
  settlements: { id: string; title: string }[];
};

export default function HandoverWorkspace({ user }: { user: User }) {
  const [options, setOptions] = useState<Options>({
    organizations: [],
    people: {},
  });
  const [org, setOrg] = useState("");
  const [rows, setRows] = useState<Handover[]>([]);
  const [selected, setSelected] = useState("");
  const [references, setReferences] = useState<References>({
    documents: [],
    settlements: [],
  });
  const [kind, setKind] = useState("task");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const latestRequest = useRef(0);
  const refresh = useCallback(async () => {
    const requestId = ++latestRequest.current;
    const next = await api<Options>("/handovers/options");
    if (requestId !== latestRequest.current) return;
    setOptions(next);
    const chosen = next.organizations.some((item) => item.id === org)
      ? org
      : next.organizations[0]?.id || "";
    if (chosen !== org) setOrg(chosen);
    setRows([]);
    setReferences({ documents: [], settlements: [] });
    if (chosen) {
      const [items, refs] = await Promise.all([
        api<Handover[]>(`/handovers?org_id=${encodeURIComponent(chosen)}`),
        api<References>(
          `/handovers/reference-options?org_id=${encodeURIComponent(chosen)}`,
        ),
      ]);
      if (requestId === latestRequest.current) {
        setRows(items);
        setReferences(refs);
      }
    }
  }, [org]);
  useEffect(() => {
    refresh().catch((e) => setError((e as Error).message));
  }, [refresh]);
  async function perform(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await refresh();
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const v = Object.fromEntries(new FormData(form));
    await perform(async () => {
      const saved = await api<{ id: string }>("/handovers", {
        org_id: org,
        year: Number(v.year),
        title: v.title,
        from_user_id: v.from_user_id,
        to_user_id: v.to_user_id,
      });
      setSelected(saved.id);
    }, "인수인계 묶음을 만들었습니다. 필수 항목을 추가해 주세요.");
  }
  async function addItem(e: FormEvent<HTMLFormElement>, row: Handover) {
    e.preventDefault();
    const form = e.currentTarget;
    const v = Object.fromEntries(new FormData(form));
    await perform(
      () =>
        api(`/handovers/${row.id}/items`, {
          kind,
          reference_id: v.reference_id || null,
          title: v.title,
          required: v.required === "on",
          expected_revision: row.revision,
        }),
      "인계 항목을 추가했습니다.",
    );
    form.reset();
    setKind("task");
  }
  const current = rows.find((r) => r.id === selected);
  const people = options.people[org] || [];
  const referenceList =
    kind === "document" ? references.documents : references.settlements;
  return (
    <div className="handover-page">
      <section className="panel">
        <h2>인수인계</h2>
        <p className="muted">
          연도 전환과 중도 교체 모두 기록합니다. 역할 부여·회수는 조직·권한에서
          별도로 처리하며, 인수자는 필수 항목을 직접 확인합니다.
        </p>
        <label>
          단체{" "}
          <select
            value={org}
            onChange={(e) => {
              setOrg(e.target.value);
              setSelected("");
              setRows([]);
              setReferences({ documents: [], settlements: [] });
            }}
          >
            <option value="">선택</option>
            {options.organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
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
      </section>
      {org && (
        <section className="panel">
          <h2>새 인수인계</h2>
          <p className="muted">
            현재 담당자가 인계하고, 후임은 같은 단체의 현재·예정 역할을 가진
            계정이어야 합니다.
          </p>
          <form className="handover-form" onSubmit={create}>
            <label>
              기록 연도{" "}
              <input
                name="year"
                type="number"
                min="2000"
                max="2200"
                defaultValue={new Date().getFullYear()}
                required
              />
            </label>
            <label>
              인계자{" "}
              <select name="from_user_id" defaultValue={user.id} required>
                <option value="">선택</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              인수자{" "}
              <select name="to_user_id" required>
                <option value="">선택</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="wide">
              제목{" "}
              <input
                name="title"
                minLength={2}
                maxLength={180}
                placeholder="예: 2026년 하반기 업무 인수인계"
                required
              />
            </label>
            <button disabled={busy}>묶음 만들기</button>
          </form>
        </section>
      )}
      <section className="panel">
        <h2>인수인계 목록</h2>
        {rows.length === 0 && (
          <p className="muted">현재 볼 수 있는 인수인계가 없습니다.</p>
        )}
        <div className="handover-list">
          {rows.map((row) => (
            <button
              key={row.id}
              className={selected === row.id ? "active" : ""}
              onClick={() => setSelected(row.id === selected ? "" : row.id)}
            >
              <strong>{row.title}</strong>
              <span>
                {row.year}년 · {row.from_name} → {row.to_name} ·{" "}
                {row.completed_at ? "인수 완료" : "진행 중"}
              </span>
            </button>
          ))}
        </div>
      </section>
      {current && (
        <section className="panel">
          <h2>{current.title}</h2>
          <p className="muted">
            작성자와 인수 확인자가 기록됩니다. 완료 후 항목은 잠기고 역할 권한은
            별도로 관리합니다.
          </p>
          <div className="handover-list">
            {current.items.map((item) => (
              <div key={item.id}>
                <strong>{item.title}</strong>
                <span>
                  {item.kind === "task"
                    ? "업무"
                    : item.kind === "document"
                      ? "자료"
                      : "정산"}{" "}
                  · {item.required ? "필수" : "선택"} ·{" "}
                  {item.checked_at ? "인수자 확인 완료" : "확인 대기"}
                </span>
                {item.reference_id && (
                  <small>참조 ID: {item.reference_id}</small>
                )}
                {user.id === current.to_user_id &&
                  !current.completed_at &&
                  !item.checked_at && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        perform(
                          () =>
                            api(
                              `/handovers/${current.id}/items/${item.id}/check`,
                              { expected_revision: current.revision },
                            ),
                          "인수 확인을 기록했습니다.",
                        )
                      }
                    >
                      확인했습니다
                    </button>
                  )}
              </div>
            ))}
          </div>
          {!current.completed_at &&
            (user.is_admin || user.id === current.from_user_id) && (
              <form
                className="handover-form"
                onSubmit={(e) => addItem(e, current)}
              >
                <h3>인계 항목 추가</h3>
                <label>
                  종류{" "}
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    <option value="task">업무 메모</option>
                    <option value="document">자료실 자료</option>
                    <option value="settlement">확정 정산</option>
                  </select>
                </label>
                {kind !== "task" && (
                  <label>
                    연결 기록{" "}
                    <select name="reference_id" required>
                      <option value="">선택</option>
                      {referenceList.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.title}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="wide">
                  항목 설명{" "}
                  <input name="title" minLength={2} maxLength={250} required />
                </label>
                <label className="check">
                  <input name="required" type="checkbox" defaultChecked />
                  필수 확인
                </label>
                <button disabled={busy}>항목 추가</button>
              </form>
            )}
          {user.id === current.to_user_id && !current.completed_at && (
            <button
              disabled={
                busy ||
                current.items.length === 0 ||
                current.items.some((item) => item.required && !item.checked_at)
              }
              onClick={() =>
                perform(
                  () =>
                    api(`/handovers/${current.id}/complete`, {
                      expected_revision: current.revision,
                    }),
                  "인수인계를 완료했습니다.",
                )
              }
            >
              인수인계 완료
            </button>
          )}
        </section>
      )}
    </div>
  );
}
