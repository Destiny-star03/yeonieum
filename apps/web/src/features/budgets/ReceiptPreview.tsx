import { useEffect, useState } from "react";

export function receiptPreviewType(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (/\.jpe?g$/.test(lower)) return "image/jpeg";
  return null;
}

const signatures = {
  "application/pdf": [37, 80, 68, 70, 45],
  "image/png": [137, 80, 78, 71, 13, 10, 26, 10],
  "image/jpeg": [255, 216, 255],
};

export default function ReceiptPreview({
  filename,
  file,
  evidenceId,
}: { filename: string } & (
  { file: File; evidenceId?: never } | { evidenceId: string; file?: never }
)) {
  const type = receiptPreviewType(filename);
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let previewUrl = "";
    setUrl("");
    setFailed(false);

    async function load() {
      if (!type) return;
      let blob: Blob;
      if (file) {
        const signature = signatures[type];
        const bytes = new Uint8Array(
          await file.slice(0, signature.length).arrayBuffer(),
        );
        if (!signature.every((byte, index) => bytes[index] === byte))
          throw new Error();
        blob = file.slice(0, file.size, type);
      } else {
        const response = await fetch(
          `/api/budgets/evidence/${encodeURIComponent(evidenceId)}/preview`,
          { credentials: "same-origin", signal: controller.signal },
        );
        if (
          !response.ok ||
          response.headers.get("Content-Type") !== type ||
          !/^inline(?:\s*;|\s*$)/i.test(
            response.headers.get("Content-Disposition") || "",
          )
        )
          throw new Error();
        blob = await response.blob();
      }
      if (controller.signal.aborted) return;
      previewUrl = URL.createObjectURL(blob);
      setUrl(previewUrl);
    }

    load().catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => {
      controller.abort();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [evidenceId, file, type]);

  if (!type) return null;
  if (failed)
    return (
      <p className="finance-input-note" role="status">
        영수증 미리보기를 불러올 수 없습니다.
      </p>
    );
  if (!url)
    return (
      <p className="finance-input-note" role="status">
        영수증 미리보기를 불러오는 중…
      </p>
    );
  return (
    <div className="finance-receipt-preview">
      {type === "application/pdf" ? (
        <iframe src={url} title={`${filename} 미리보기`} />
      ) : (
        <img
          src={url}
          alt={`${filename} 미리보기`}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
