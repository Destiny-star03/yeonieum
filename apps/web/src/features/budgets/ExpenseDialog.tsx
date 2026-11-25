import { useEffect, useRef, useState, type FormEvent } from "react";
import FileDropzone from "../documents/FileDropzone";
import "../documents/documents.css";
import ReceiptPreview, { receiptPreviewType } from "./ReceiptPreview";
import { paymentMethods } from "./resolution";

type Preview = {
  items: { row: number; purpose: string; amount: number }[];
  total: number;
  sheet: string;
  notice: string;
};
const importLimit = 5 * 1024 * 1024;
const amountLimit = 10 ** 15;
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
  remaining,
  canEvidence,
  onClose,
  onSaved,
}: {
  org: string;
  orgName: string;
  year: number;
  userId: string;
  people: { id: string; name: string }[];
  remaining: number;
  canEvidence: boolean;
  onClose: () => void;
  onSaved: (id: string, hasEvidence: boolean) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  const previewRequest = useRef<AbortController | null>(null);
  const [savedId, setSavedId] = useState("");
  const [retrySubmission, setRetrySubmission] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [importError, setImportError] = useState("");
  const [receiptError, setReceiptError] = useState("");
  const [busy, setBusy] = useState(false),
    [reading, setReading] = useState(false),
    [error, setError] = useState("");
  const [purpose, setPurpose] = useState(""),
    [amount, setAmount] = useState({ value: "", fromFile: false });
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
  const [title, setTitle] = useState("");
  const [payee, setPayee] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const locked = busy || retrySubmission || Boolean(savedId);
  const amountInWon = Number(amount.value);
  const validAmount =
    Number.isSafeInteger(amountInWon) &&
    amountInWon > 0 &&
    amountInWon <= amountLimit;
  useEffect(() => {
    dialog.current?.showModal();
    return () => {
      previewRequest.current?.abort();
      previewRequest.current = null;
    };
  }, []);
  function selectFile(next: File | null) {
    previewRequest.current?.abort();
    previewRequest.current = null;
    setReading(false);
    setFile(next);
    setPreview(null);
    setImportError("");
    setReceiptError("");
    setError("");
    setAmount((current) =>
      current.fromFile ? { value: "", fromFile: false } : current,
    );
    if (!next || !/\.(xlsx|csv)$/i.test(next.name)) return;
    if (next.size > importLimit) {
      setImportError("표 자동 읽기는 5 MiB 이하의 파일을 지원합니다.");
      return;
    }
    void readFile(next);
  }
  async function readFile(source: File) {
    const controller = new AbortController();
    previewRequest.current = controller;
    setReading(true);
    setImportError("");
    try {
      const response = await fetch(
        `/api/budgets/import-preview?${new URLSearchParams({ org_id: org, year: String(year), filename: source.name })}`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/octet-stream" },
          body: source,
          signal: controller.signal,
        },
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          typeof body.detail === "string"
            ? body.detail
            : "내역을 읽을 수 없습니다.",
        );
      if (previewRequest.current !== controller) return;
      const result: Preview = body;
      setPreview(result);
      setAmount((current) =>
        current.value
          ? current
          : { value: String(result.total), fromFile: true },
      );
    } catch (e) {
      if (previewRequest.current === controller)
        setImportError((e as Error).message);
    } finally {
      if (previewRequest.current === controller) {
        previewRequest.current = null;
        setReading(false);
      }
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || reading) return;
    setBusy(true);
    setError("");
    setReceiptError("");
    let id = savedId;
    try {
      if (!id) {
        const expense = JSON.stringify({
          request_id: requestId,
          org_id: org,
          year,
          spent_on: date,
          purpose,
          amount: amountInWon,
          executor_id: executor,
          resolution: { title, payee, payment_method: paymentMethod },
        });
        const form = new FormData();
        if (file) {
          form.set("expense", expense);
          form.set("receipt", file);
        }
        const response = await fetch(
          file ? "/api/budgets/expenses/submit" : "/api/budgets/expenses",
          {
            method: "POST",
            credentials: "same-origin",
            headers: file ? undefined : { "Content-Type": "application/json" },
            body: file ? form : expense,
          },
        );
        const body: { id?: unknown; detail?: unknown } | null =
          await response.json();
        if (!response.ok) {
          const detail = body?.detail;
          if (
            file &&
            detail &&
            typeof detail === "object" &&
            "field" in detail &&
            detail.field === "receipt" &&
            "message" in detail &&
            typeof detail.message === "string"
          ) {
            setReceiptError(detail.message);
            return;
          }
          if (
            response.status >= 400 &&
            response.status < 500 &&
            ![408, 425, 429].includes(response.status)
          ) {
            if (typeof detail === "string" || Array.isArray(detail)) {
              setError(
                typeof detail === "string"
                  ? detail
                  : "지출 입력 내용을 확인해 주세요.",
              );
              return;
            }
          }
          throw new Error();
        }
        if (typeof body?.id !== "string" || !body.id) throw new Error();
        id = body.id;
        setSavedId(id);
      }
      await onSaved(id, Boolean(file));
      onClose();
    } catch {
      if (id) {
        setError("지출은 저장되었습니다. 지출 상세를 다시 불러와 주세요.");
      } else {
        setRetrySubmission(true);
        setError(
          file
            ? "저장 결과를 확인하지 못했습니다. 같은 지출과 영수증으로 다시 시도해 주세요."
            : "저장 결과를 확인하지 못했습니다. 같은 지출로 다시 시도해 주세요.",
        );
      }
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
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit}>
        <div className="library-upload-heading">
          <div>
            <h2 id="expense-dialog-title">지출결의서 작성</h2>
            <p>
              {year}년 · {orgName}
            </p>
          </div>
          <button
            type="button"
            aria-label="지출결의서 작성창 닫기"
            disabled={busy}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <fieldset disabled={locked} className="library-upload-fields">
          <label>
            결의서 제목
            <input
              name="title"
              required
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 정기총회 운영 물품 구입"
            />
          </label>
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
          </div>
          <label>
            지출 목적
            <textarea
              name="purpose"
              required
              maxLength={300}
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              rows={2}
              placeholder="어디에, 무엇을 위해 사용했는지 적어 주세요."
            />
          </label>
          <div className="library-field-grid">
            <label>
              금액 (원)
              <input
                name="amount"
                type="number"
                min={1}
                max={amountLimit}
                step={1}
                required
                value={amount.value}
                onChange={(e) =>
                  setAmount({ value: e.target.value, fromFile: false })
                }
              />
            </label>
            <label>
              <span>
                결제 수단 <small>선택</small>
              </span>
              <select
                name="payment_method"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              >
                <option value="">선택</option>
                {Object.entries(paymentMethods).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            <span>
              거래처 / 지급처 <small>선택</small>
            </span>
            <input
              name="payee"
              maxLength={120}
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
            />
          </label>
        </fieldset>
        {canEvidence ? (
          <section
            className="finance-expense-evidence"
            aria-labelledby="expense-evidence-title"
          >
            <h3 id="expense-evidence-title">
              영수증 첨부 <small>선택</small>
            </h3>
            <FileDropzone
              file={file}
              extensions={extensions}
              disabled={locked}
              selectedHint="결의서를 제출하면 함께 저장됩니다"
              onChange={selectFile}
            />
            {receiptError && (
              <p className="error finance-receipt-error" role="alert">
                {receiptError}
              </p>
            )}
            {file && receiptPreviewType(file.name) && (
              <ReceiptPreview filename={file.name} file={file} />
            )}
            <p className="finance-input-note">
              XLSX·UTF-8 CSV는 합계를 읽어 빈 금액 칸에 입력합니다. 영수증과
              한글·Word 결의서는 증빙으로 첨부하고 금액을 직접 입력하세요.
            </p>
            {!file && (
              <p className="finance-input-note">
                증빙은 제출한 뒤에도 상세에서 추가할 수 있습니다.
              </p>
            )}
            {reading && <p role="status">첨부한 표의 지출 내역을 읽는 중…</p>}
            {importError && (
              <div className="finance-import-actions">
                <p className="finance-input-note" role="status">
                  {importError} 금액을 직접 입력해 지출을 기록할 수 있습니다.
                </p>
                {file && file.size <= importLimit && (
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => void readFile(file)}
                  >
                    표 다시 읽기
                  </button>
                )}
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
                <p role="status">
                  {amount.fromFile
                    ? "표의 합계를 입력했습니다. 실제 지출과 대조해 필요하면 수정하세요."
                    : "실제 지출을 확인한 금액으로 기록하세요."}
                </p>
                {amount.value !== String(preview.total) && (
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() =>
                      setAmount({
                        value: String(preview.total),
                        fromFile: true,
                      })
                    }
                  >
                    표의 합계를 금액에 적용
                  </button>
                )}
                <details>
                  <summary>읽어온 행과 합산 기준 보기</summary>
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
                </details>
              </section>
            )}
          </section>
        ) : (
          <p className="finance-input-note">
            증빙 등록 권한이 없습니다. 선생님에게 권한을 요청하고 실제 지출은
            먼저 기록할 수 있습니다.
          </p>
        )}
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
        {busy && (
          <p role="status">
            {savedId
              ? "지출 상세를 불러오고 있습니다…"
              : file
                ? "지출과 증빙을 저장하고 있습니다…"
                : "지출을 저장하고 있습니다…"}
          </p>
        )}
        <footer className="finance-submission-footer">
          {!savedId && (
            <div className="finance-expected-balance" aria-live="polite">
              <span>제출 후 예상 연간 잔액</span>
              <strong>
                {validAmount
                  ? `${(remaining - amountInWon).toLocaleString("ko-KR")}원`
                  : "금액 입력 후 계산"}
              </strong>
              {validAmount && (
                <small>
                  잔액에서 {amountInWon.toLocaleString("ko-KR")}원을 한 번
                  차감합니다.
                </small>
              )}
            </div>
          )}
          <div className="dialog-actions">
            <button type="button" disabled={busy} onClick={onClose}>
              닫기
            </button>
            <button className="primary" disabled={busy || reading}>
              {busy
                ? "저장 중…"
                : savedId
                  ? "지출 상세 다시 불러오기"
                  : retrySubmission
                    ? "결의서 제출 재시도"
                    : "결의서 제출"}
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
