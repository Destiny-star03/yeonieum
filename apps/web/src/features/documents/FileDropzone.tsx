import { useEffect, useRef, useState, type DragEvent } from "react";
import { fileSize } from "./api";

export default function FileDropzone({
  file,
  extensions,
  disabled,
  onChange,
}: {
  file: File | null;
  extensions: string[];
  disabled: boolean;
  onChange: (file: File | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
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
  function select(files: File[]) {
    if (disabled) return;
    setDragging(false);
    depth.current = 0;
    let message = "";
    const next = files[0];
    if (files.length !== 1)
      message =
        "파일은 한 번에 1개씩 선택해 주세요. 폴더는 업로드할 수 없습니다.";
    else if (!next.size)
      message =
        "빈 파일은 등록할 수 없습니다. 내용이 있는 파일을 선택해 주세요.";
    else if (next.size > 50 * 1024 * 1024)
      message = "파일이 50 MiB를 넘습니다. 더 작은 파일을 선택해 주세요.";
    else if (!extensions.some((ext) => next.name.toLowerCase().endsWith(ext)))
      message =
        "지원하지 않는 파일 형식입니다. 아래 지원 형식을 확인해 주세요.";
    setError(message);
    onChange(message ? null : next);
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
        className={`library-dropzone ${dragging && !disabled ? "is-dragging" : ""} ${file ? "has-file" : ""}`}
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
          if (!disabled) select(Array.from(e.dataTransfer.files));
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
          {file ? "파일 바꾸기" : "파일 선택"}
        </button>
        <small id="upload-file-hint">파일 1개 · 최대 50 MiB</small>
        <input
          ref={input}
          className="library-file-input"
          type="file"
          aria-label="업로드 파일"
          aria-describedby="upload-file-hint"
          tabIndex={-1}
          disabled={disabled}
          accept={extensions.join(",")}
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
              {fileSize(file.size)} · 선택됨, 등록 버튼을 눌러 저장하세요
            </small>
          </div>
          <button
            type="button"
            aria-label="선택한 파일 제거"
            disabled={disabled}
            onClick={() => {
              onChange(null);
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
