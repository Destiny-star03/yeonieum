export type Unit = {
  id: string;
  org_id: string;
  parent_id: string | null;
  kind: string;
  name: string;
  in_scope: boolean;
};
export type Person = {
  id: string;
  name: string;
  unit_ids?: string[];
  identifier?: string;
  email?: string;
  phone?: string;
  is_admin?: number;
};
export type Assignment = {
  id: string;
  user_id: string;
  unit_id: string;
  role: string;
  starts_at: string;
  ends_at: string;
  revoked_at: string | null;
  effective: boolean;
  prerequisite_id: string | null;
};
export type Workspace = {
  units: Unit[];
  users: Person[];
  assignments: Assignment[];
  contacts: (Person & { org_id: string; org_name: string })[];
  grant_options: { unit_id: string; role: string }[];
  roles: Record<string, string>;
  server_time: string;
};
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...(body !== undefined
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const text = await response.text();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    value = { detail: text };
  }
  if (!response.ok)
    throw new Error(
      typeof value.detail === "string"
        ? value.detail
        : "입력 내용을 확인해 주세요.",
    );
  return value as T;
}
