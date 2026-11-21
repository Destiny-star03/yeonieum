import { useState } from "react";
import { api } from "../../shared/api";
import { formatDate } from "../../shared/tenure";
import DocumentFields from "./DocumentFields";
import {
  downloadFile,
  fileSize,
  metadataOf,
  type LibraryDocument,
  type LibraryOptions,
  type LibraryVersion,
} from "./api";

export default function DocumentDetail({
  row,
  versions,
  options,
  busy,
  onClose,
  onVersion,
  onChanged,
  perform,
}: {
  row: LibraryDocument;
  versions: LibraryVersion[];
  options: LibraryOptions;
  busy: boolean;
  onClose: () => void;
  onVersion: () => void;
  onChanged: () => Promise<void>;
  perform: (fn: () => Promise<void>, message: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false),
    [metadata, setMetadata] = useState(metadataOf(row));
  const [confirmation, setConfirmation] = useState<
    null | "trash" | "restore" | number
  >(null);
  async function confirm() {
    if (confirmation === null) return;
    await perform(
      async () => {
        await api(
          `/documents/${row.id}/${typeof confirmation === "number" ? "restore-version" : confirmation}`,
          {
            expected_revision: row.revision,
            ...(typeof confirmation === "number"
              ? { version: confirmation }
              : {}),
          },
        );
        setConfirmation(null);
        await onChanged();
      },
      typeof confirmation === "number"
        ? "과거 파일을 새 버전으로 복원했습니다."
        : confirmation === "trash"
          ? "자료를 휴지통으로 이동했습니다. 파일과 버전은 보존됩니다."
          : "자료를 복원했습니다.",
    );
  }
  return (
    <section
      className="panel library-detail"
      aria-labelledby="document-detail-title"
    >
      <div className="section-heading">
        <h2 id="document-detail-title">{row.title}</h2>
        <button onClick={onClose}>상세 닫기</button>
      </div>
      <p className="muted">
        {row.org_name} / {row.unit_name} · {row.academic_year}학년도 ·{" "}
        {row.category}
      </p>
      <p className="library-description">
        {row.description || "등록된 설명이 없습니다."}
      </p>
      <dl className="library-info">
        <div>
          <dt>폴더</dt>
          <dd>{row.folder_name || row.folder || "단체 자료함"}</dd>
        </div>
        <div>
          <dt>행사</dt>
          <dd>{row.event || "없음"}</dd>
        </div>
        <div>
          <dt>열람 대상</dt>
          <dd>
            {row.audience === "private"
              ? "개인 보관 · 나만 보기"
              : row.audience === "organization"
                ? "단체 공유 · 단체 담당자"
                : row.audience === "unit"
                  ? "해당 담당 범위"
                  : row.audience === "council-officers"
                    ? "학과협의회 간부진"
                    : "해당 학과 담당자"}
          </dd>
        </div>
      </dl>
      {row.can_manage && !row.deleted_at && (
        <div className="library-actions">
          <button disabled={busy} onClick={onVersion}>
            새 버전 등록
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setMetadata(metadataOf(row));
              setEditing(!editing);
            }}
          >
            분류·공유 수정
          </button>
          <button
            disabled={busy}
            className="text-button"
            onClick={() => setConfirmation("trash")}
          >
            휴지통으로 이동
          </button>
        </div>
      )}
      {row.can_manage && row.deleted_at && (
        <button disabled={busy} onClick={() => setConfirmation("restore")}>
          자료 복원
        </button>
      )}
      {editing && !row.deleted_at && (
        <form
          className="library-edit"
          onSubmit={(e) => {
            e.preventDefault();
            void perform(async () => {
              await api(`/documents/${row.id}/metadata`, {
                metadata,
                expected_revision: row.revision,
              });
              setEditing(false);
              await onChanged();
            }, "자료의 분류와 열람 대상을 수정했습니다.");
          }}
        >
          <DocumentFields
            value={metadata}
            onChange={setMetadata}
            units={options.units}
            lockScope
          />
          <button className="primary" disabled={busy}>
            분류·공유 저장
          </button>
        </form>
      )}
      {confirmation !== null && (
        <div
          className="library-confirm"
          role="group"
          aria-label="자료 변경 확인"
        >
          <strong>
            {typeof confirmation === "number"
              ? `v${confirmation} 파일을 새 버전으로 복원하시겠습니까?`
              : confirmation === "trash"
                ? "자료를 휴지통으로 이동하시겠습니까?"
                : "자료를 복원하시겠습니까?"}
          </strong>
          <p>
            {confirmation === "trash"
              ? "일반 목록과 다운로드에서 제외합니다. 이전 버전과 감사 이력은 보존하며 영구 삭제하지 않습니다."
              : "기존 버전과 감사 이력을 유지합니다. 현재 권한과 자료 상태를 다시 확인합니다."}
          </p>
          <div className="library-actions">
            <button disabled={busy} onClick={() => setConfirmation(null)}>
              취소
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void confirm()}
            >
              확인하고 실행
            </button>
          </div>
        </div>
      )}
      <h3>파일과 버전</h3>
      <ol className="library-versions">
        {versions.map((version) => (
          <li key={version.version}>
            <div>
              <strong>
                v{version.version}
                {row.current_version === version.version
                  ? " · 현재"
                  : ""} — {version.filename}
              </strong>
              <small>
                {fileSize(version.size)} · {formatDate(version.created_at)} ·{" "}
                {version.note || "설명 없음"}
              </small>
              <details>
                <summary>파일 체크섬</summary>
                <code>{version.checksum}</code>
              </details>
            </div>
            {!row.deleted_at && (
              <div className="library-actions">
                <button
                  disabled={busy}
                  aria-label={`v${version.version} 다운로드`}
                  onClick={() =>
                    void perform(
                      () => downloadFile(row.id, version),
                      "파일을 내려받았습니다.",
                    )
                  }
                >
                  다운로드
                </button>
                {row.can_manage && version.version !== row.current_version && (
                  <button
                    disabled={busy}
                    onClick={() => setConfirmation(version.version)}
                  >
                    이 버전 복원
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
