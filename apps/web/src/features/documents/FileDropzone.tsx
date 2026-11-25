import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { fileSize } from "./api";

type PickerProps = {
  extensions: string[];
  disabled: boolean;
  maxSize?: number;
  selectedHint?: string;
} & (
  | {
      file: File | null;
      onChange: (file: File | null) => void;
      onAdd?: never;
      count?: never;
    }
  | {
      onAdd: (files: File[]) => void;
      count: number;
      file?: never;
      onChange?: never;
    }
);

export default function FileDropzone({
  file,
  extensions,
  disabled,
  onChange,
  onAdd,
  count = 0,
  maxSize = 50 * 1024 * 1024,
  selectedHint = "선택됨, 등록 버튼을 눌러 저장하세요",
}: PickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const hint = useId();
  const limitLabel = `${maxSize / 1024 / 1024} MiB`;
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    // Dropping outside the target must not navigate away from the open form.
    const preventNavigation = (e: globalThis.DragEvent) => {
      if (Array.from(e.dataTransfer?.types || []).includes("Files"))
        e.preventDefault();
    };
    window.addEventListener("dragover", preventNavigation);
    window.addEventListener("drop", preventNavigation);
    return () => {
      window.removeEventListener("dragover", preventNavigation);
      window.removeEventListener("drop", preventNavigation);
    };
  }, []);
  function select(files: File[], hasFolder = false) {
    if (disabled) return;
    setDragging(false);
    depth.current = 0;
    const errors = new Set<string>();
    if (hasFolder) errors.add("폴더 대신 안에 있는 파일을 선택해 주세요.");
    if (onChange && files.length !== 1)
      errors.add("파일은 한 번에 1개씩 선택해 주세요.");
    const valid = files.filter((entry) => {
      let reason = "";
      if (!entry.size) reason = "빈 파일은 등록할 수 없습니다.";
      else if (entry.size > maxSize)
        reason = `파일이 ${limitLabel}를 넘습니다.`;
      else if (
        !extensions.some((ext) => entry.name.toLowerCase().endsWith(ext))
      )
        reason = "지원하지 않는 파일 형식입니다.";
      if (reason) errors.add(onAdd ? `${entry.name} · ${reason}` : reason);
      return !reason;
    });
    setError([...errors].join("\n"));
    if (onAdd && valid.length) onAdd(valid);
    if (onChange) onChange(errors.size ? null : valid[0] || null);
    if (input.current) input.current.value = "";
  }
  function drag(e: DragEvent) {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return false;
    e.preventDefault();
    e.stopPropagation();
    return true;
  }
  return (
    <div className="library-file-picker">
      <div
        className={`library-dropzone ${dragging && !disabled ? "is-dragging" : ""} ${file || count ? "has-file" : ""}`}
        role="group"
        aria-label="파일 업로드 영역"
        aria-disabled={disabled}
        onDragEnter={(e) => {
          if (drag(e) && !disabled) {
            depth.current++;
            setDragging(true);
          }
        }}
        onDragOver={(e) => {
          if (drag(e)) e.dataTransfer.dropEffect = disabled ? "none" : "copy";
        }}
        onDragLeave={(e) => {
          if (drag(e)) {
            depth.current = Math.max(0, depth.current - 1);
            if (!depth.current) setDragging(false);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (disabled) return;
          const entries = Array.from(e.dataTransfer.items).filter(
            (item) => item.kind === "file",
          );
          const directories = entries.map(
            (item) => item.webkitGetAsEntry?.()?.isDirectory ?? false,
          );
          const files = directories.some(Boolean)
            ? entries.flatMap((item, index) => {
                const entry = directories[index] ? null : item.getAsFile();
                return entry ? [entry] : [];
              })
            : Array.from(e.dataTransfer.files);
          select(files, directories.some(Boolean));
        }}
      >
        <span className="library-drop-icon" aria-hidden="true">
          <svg
            viewBox="0 0 32 32"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M16 21V5m-6 6 6-6 6 6M6 20v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6" />
          </svg>
        </span>
        <strong>
          {dragging && !disabled
            ? "여기에 놓으면 파일이 선택됩니다"
            : file
              ? "다른 파일로 바꾸려면 여기에 놓으세요"
              : count
                ? "파일을 더 끌어다 놓을 수 있어요"
                : "파일을 여기에 끌어다 놓으세요"}
        </strong>
        <span className="library-drop-subtitle">
          또는 기기에서 직접 선택하세요
        </span>
        <button
          ref={chooseButton}
          type="button"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          {file ? "파일 바꾸기" : count ? "파일 더 선택" : "파일 선택"}
        </button>
        <small id={hint}>
          {onAdd ? "여러 파일 선택 가능 · 파일당" : "파일 1개 ·"} 최대{" "}
          {limitLabel}
        </small>
        <input
          ref={input}
          className="library-file-input"
          type="file"
          aria-label="업로드 파일"
          aria-describedby={hint}
          tabIndex={-1}
          disabled={disabled}
          accept={extensions.join(",")}
          multiple={Boolean(onAdd)}
          onChange={(e) => {
            if (e.target.files?.length) select(Array.from(e.target.files));
          }}
        />
      </div>
      {error && (
        <p className="error library-file-error" role="alert">
          {error}
        </p>
      )}
      {file && (
        <div className="library-selected-file" role="status">
          <span className="library-selected-icon" aria-hidden="true">
            ✓
          </span>
          <div>
            <strong>{file.name}</strong>
            <small>
              {fileSize(file.size)} · {selectedHint}
            </small>
          </div>
          <button
            type="button"
            aria-label="선택한 파일 제거"
            disabled={disabled}
            onClick={() => {
              onChange?.(null);
              setError("");
              chooseButton.current?.focus();
            }}
          >
            ✕
          </button>
        </div>
      )}
      <p className="library-upload-formats">
        PDF · 한글 · Word · Excel · PowerPoint · 이미지 · TXT·CSV
      </p>
    </div>
  );
}
