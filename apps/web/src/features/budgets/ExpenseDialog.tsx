import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../shared/api";
import FileDropzone from "../documents/FileDropzone";
import "../documents/documents.css";

type Preview = {
  items: { row: number; purpose: string; amount: number }[];
  total: number;
  sheet: string;
  notice: string;
};
const extensions = [
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".txt",
  ".csv",
  ".docx",
  ".xlsx",
  ".pptx",
  ".hwp",
  ".hwpx",
];
export default function ExpenseDialog({
  org,
  orgName,
  year,
  userId,
  people,
  events,
  canEvidence,
  onClose,
  onSaved,
  onRecorded,
}: {
  org: string;
  orgName: string;
  year: number;
  userId: string;
  people: { id: string; name: string }[];
  events: { id: string; name: string }[];
  canEvidence: boolean;
  onClose: () => void;
  onSaved: (id: string, hasEvidence: boolean) => Promise<void>;
  onRecorded: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const requestId = useRef(crypto.randomUUID());
  const [savedId, setSavedId] = useState("");
  const [attached, setAttached] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewApplied, setPreviewApplied] = useState(false);
  const [busy, setBusy] = useState(false),
    [reading, setReading] = useState(false),
    [error, setError] = useState("");
  const [purpose, setPurpose] = useState(""),
    [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    return today.startsWith(String(year)) ? today : `${year}-01-01`;
  });
  const [executor, setExecutor] = useState(
    people.some((p) => p.id === userId) ? userId : "",
  );
  const [event, setEvent] = useState("");
  const locked = busy || reading || Boolean(savedId);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function readFile() {
    if (!file) return;
    setReading(true);
    setError("");
    setPreview(null);
    setPreviewApplied(false);
    try {
      const response = await fetch(
        `/api/budgets/import-preview?${new URLSearchParams({ org_id: org, year: String(year), filename: file.name })}`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/octet-stream" },
          body: file,
        },
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          typeof body.detail === "string"
            ? body.detail
            : "내역을 읽을 수 없습니다.",
        );
      setPreview(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    let id = savedId;
    try {
      if (!id) {
        const result = await api<{ id: string }>("/budgets/expenses", {
          request_id: requestId.current,
          org_id: org,
          year,
          event_id: event || null,
          spent_on: date,
          purpose,
          amount: Number(amount),
          executor_id: executor,
        });
        id = result.id;
        setSavedId(id);
      }
      if (file && !attached) {
        const response = await fetch(
          `/api/budgets/expenses/${id}/evidence?filename=${encodeURIComponent(file.name)}`,
          {
            method: "PUT",
            credentials: "same-origin",
            headers: { "Content-Type": "application/octet-stream" },
            body: file,
          },
        );
        if (!response.ok) {
          const body = await response.json();
          throw new Error(
            typeof body.detail === "string"
              ? body.detail
              : "증빙 등록에 실패했습니다.",
          );
        }
        setAttached(true);
      }
      await onSaved(id, Boolean(file));
      onClose();
    } catch (e) {
      if (id) {
        try {
          await onRecorded();
        } catch {
          /* The saved id is retained for a retry. */
        }
      }
      setError(
        `${id ? "지출은 이미 기록되어 잔액에 반영되었습니다. 중복 차감 없이 증빙·결과 확인만 재시도합니다. " : ""}${(e as Error).message}`,
      );
    } finally {
      setBusy(false);
    }
  }
  function template() {
    const url = URL.createObjectURL(
      new Blob(["\ufeff용도,금액\n가상 행사 물품,12000\n가상 인쇄비,3000\n"], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "연이음-지출양식.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <dialog
      ref={dialog}
      className="library-dialog library-upload-dialog finance-expense-dialog"
      aria-labelledby="expense-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy && !reading) onClose();
      }}
    >
      <form onSubmit={submit}>
        <div className="library-upload-heading">
          <div>
            <span className="library-kicker">RECORD YOUR SPENDING</span>
            <h2 id="expense-dialog-title">지출과 증빙 등록</h2>
            <p>
              {year}년 · {orgName}
            </p>
          </div>
          <button
            type="button"
            aria-label="지출 등록창 닫기"
            disabled={busy || reading}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        {canEvidence ? (
          <>
            <FileDropzone
              file={file}
              extensions={extensions}
              disabled={locked}
              onChange={(next) => {
                setFile(next);
                setPreview(null);
                setPreviewApplied(false);
                setError("");
              }}
            />
            <p className="finance-input-note">
              영수증·엑셀·지출결의서를 첨부하세요. 파일 선택만으로 예산이
              차감되지는 않습니다.
            </p>
            {file && /\.(xlsx|csv)$/i.test(file.name) && (
              <div className="finance-import-actions">
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => void readFile()}
                >
                  {reading ? "읽는 중…" : "엑셀·CSV 내역 읽기"}
                </button>
                <small>5 MiB 이하 · 용도/금액 열 · 최대 500행</small>
              </div>
            )}
            {preview && (
              <section
                className="finance-import-preview"
                aria-label="읽어온 지출 미리보기"
              >
                <strong>
                  {preview.sheet} · {preview.items.length}개 내역 · 합계{" "}
                  {preview.total.toLocaleString()}원
                </strong>
                <div className="finance-preview-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>행</th>
                        <th>용도</th>
                        <th>금액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.items.map((r) => (
                        <tr key={r.row}>
                          <td>{r.row}</td>
                          <td>{r.purpose}</td>
                          <td>{r.amount.toLocaleString()}원</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p>{preview.notice}</p>
                <button
                  type="button"
                  disabled={locked || previewApplied}
                  onClick={() => {
                    setAmount(String(preview.total));
                    if (!purpose)
                      setPurpose(
                        `${file!.name.replace(/\.[^.]+$/, "")} 합계`.slice(
                          0,
                          300,
                        ),
                      );
                    setPreviewApplied(true);
                  }}
                >
                  {previewApplied
                    ? "합계를 금액에 입력했습니다"
                    : "확인한 합계를 지출 1건에 입력"}
                </button>
              </section>
            )}
          </>
        ) : (
          <p className="finance-input-note">
            증빙 등록 권한이 없습니다. 선생님에게 권한을 요청하고 실제 지출은
            먼저 기록할 수 있습니다.
          </p>
        )}
        <fieldset disabled={locked} className="library-upload-fields">
          <div className="library-field-grid">
            <label>
              집행일
              <input
                name="spent_on"
                type="date"
                required
                min={`${year}-01-01`}
                max={`${year}-12-31`}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              금액 (원)
              <input
                name="amount"
                type="number"
                min={1}
                max={10 ** 15}
                step={1}
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
          </div>
          <label>
            용도
            <input
              name="purpose"
              required
              maxLength={300}
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="예: 행사 준비 물품 구입"
            />
          </label>
          <div className="library-field-grid">
            <label>
              실제 집행자
              <select
                name="executor_id"
                required
                value={executor}
                onChange={(e) => setExecutor(e.target.value)}
              >
                <option value="">집행자 선택</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              행사
              <select
                name="event_id"
                value={event}
                onChange={(e) => setEvent(e.target.value)}
              >
                <option value="">연간 일반 지출</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>
        {canEvidence && !file && (
          <button
            type="button"
            className="finance-template-link"
            disabled={locked}
            onClick={template}
          >
            엑셀에서 사용할 CSV 양식 받기
          </button>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {busy && <p role="status">지출과 증빙을 저장하고 있습니다…</p>}
        <p className="finance-input-note">
          등록한 금액을 잔액에서 한 번 차감합니다. 검토는 별도이며, 증빙이
          없어도 실제 지출 기록은 보존됩니다.
        </p>
        <div className="dialog-actions library-upload-footer">
          <button type="button" disabled={busy || reading} onClick={onClose}>
            닫기
          </button>
          <button className="primary" disabled={busy || reading}>
            {busy
              ? "저장 중…"
              : savedId
                ? "증빙·결과 확인 재시도"
                : "지출 기록"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
