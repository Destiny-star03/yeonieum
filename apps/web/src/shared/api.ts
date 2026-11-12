export type Unit = {
  id: string;
  org_id: string;
  parent_id: string | null;
  kind: string;
  name: string;
  in_scope: boolean;
  active: number;
};
export type Person = {
  id: string;
  name: string;
  unit_ids?: string[];
  identifier?: string;
  email?: string;
  phone?: string;
  is_admin?: number;
  email_verified?: number;
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
  role_label: string;
};
export type RoleDefinition = {
  id: string;
  org_id: string;
  code: string;
  label: string;
  scope_kind: string;
  builtin: number;
  active: number;
};
export type SharingGroup = {
  key: string;
  kind: "council_officers" | "department";
  label: string;
  unit_id: string;
  members: {
    user_id: string;
    name: string;
    roles: string[];
    department_names: string[];
    is_chair: boolean;
  }[];
};
export type Workspace = {
  units: Unit[];
  users: Person[];
  assignments: Assignment[];
  contacts: (Person & { org_id: string; org_name: string })[];
  grant_options: { unit_id: string; role: string; label: string }[];
  role_definitions: RoleDefinition[];
  can_manage_role_types: boolean;
  unit_creation_options: { parent_id: string; org_id: string; kind: string }[];
  sharing_groups: SharingGroup[];
  scope_kinds: Record<string, string>;
  role_scope_kinds: Record<string, string[]>;
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
        : Array.isArray(value.detail)
          ? [
              ...new Set(
                value.detail.map(
                  (e: { loc?: string[] }) =>
                    ({
                      identifier: "학번은 숫자 8자리여야 합니다.",
                      password:
                        "비밀번호는 8자 이상, 숫자·특수문자 포함이어야 합니다.",
                      email: "이메일 주소 형식을 확인해 주세요.",
                      unit_ids: "소속을 한 개 이상 선택해 주세요.",
                    })[e.loc?.at(-1) || ""] || "입력 내용을 확인해 주세요.",
                ),
              ),
            ].join(" ")
          : "입력 내용을 확인해 주세요.",
    );
  return value as T;
}
