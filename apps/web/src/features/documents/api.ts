import { api } from "../../shared/api";

export type LibraryMetadata = {
  unit_id: string;
  title: string;
  description: string;
  academic_year: number;
  category: string;
  folder: string;
  event: string;
  audience: string;
  folder_id?: string | null;
};
export type LibraryDocument = LibraryMetadata & {
  id: string;
  org_id: string;
  org_name: string;
  unit_name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  current_version: number;
  revision: number;
  can_manage: boolean;
  filename: string;
  size: number;
  folder_name?: string | null;
};
export type LibraryVersion = {
  version: number;
  filename: string;
  size: number;
  checksum: string;
  created_at: string;
  note: string;
};
export type LibraryOption = {
  id: string;
  org_id: string;
  label: string;
  audiences: { key: string; label: string }[];
};
export type LibraryOptions = {
  units: LibraryOption[];
  organizations: { id: string; name: string }[];
  extensions: string[];
  max_size: number;
  years?: number[];
};
export type LibraryFolder = {
  id: string;
  org_id: string;
  academic_year: number;
  parent_id: string | null;
  name: string;
  audience: "private" | "organization";
  created_by: string;
};
export const metadataOf = (row: LibraryDocument): LibraryMetadata => ({
  unit_id: row.unit_id,
  title: row.title,
  description: row.description,
  academic_year: row.academic_year,
  category: row.category,
  folder: row.folder,
  event: row.event,
  audience: row.audience,
  folder_id: row.folder_id,
});
export const fileSize = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KiB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;

export async function uploadFile(
  file: File,
  metadata: LibraryMetadata | null,
  document: LibraryDocument | null,
  note: string,
) {
  if (!file.size || file.size > 50 * 1024 * 1024)
    throw new Error("파일은 1바이트~50 MiB여야 합니다.");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  const checksum = Array.from(new Uint8Array(digest), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
  const session = await api<{ id: string }>("/documents/uploads", {
    filename: file.name,
    size: file.size,
    checksum,
    metadata,
    document_id: document?.id || null,
    expected_revision: document?.revision || null,
    note,
  });
  const response = await fetch(`/api/documents/uploads/${session.id}/content`, {
    method: "PUT",
    credentials: "same-origin",
    body: file,
    headers: { "Content-Type": "application/octet-stream" },
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      typeof result.detail === "string"
        ? result.detail
        : "파일 저장에 실패했습니다.",
    );
  return result as { id: string };
}

export async function downloadFile(id: string, version: LibraryVersion) {
  const response = await fetch(
    `/api/documents/${id}/versions/${version.version}/download`,
    { credentials: "same-origin" },
  );
  if (!response.ok) {
    const result = await response.json();
    throw new Error(
      result.detail || "다운로드 권한 또는 파일 상태를 확인해 주세요.",
    );
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = version.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
