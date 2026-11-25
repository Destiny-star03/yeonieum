import { useEffect, useState } from "react";
import { api } from "../../shared/api";

type Scope = { unit_id: string; name: string; enabled: boolean };
export default function StaffScopes({
  onChanged,
}: {
  onChanged: () => Promise<void>;
}) {
  const [scopes, setScopes] = useState<Scope[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    api<Scope[]>("/documents/staff-scopes")
      .then(setScopes)
      .catch((e: Error) => setError(e.message));
  }, []);
  async function toggle(scope: Scope) {
    setBusy(true);
    setError("");
    try {
      await api("/documents/staff-scopes", {
        unit_id: scope.unit_id,
        enabled: !scope.enabled,
      });
      setScopes(await api<Scope[]>("/documents/staff-scopes"));
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel library-staff-scopes">
      <details>
        <summary>선생님의 일반 자료 관리 범위 설정</summary>
        <p className="muted">
          선택한 단체의 공유 일반 자료를 열람·등록·관리합니다. 다른 사람의 개인
          보관 자료는 열람하지 않습니다. 설정과 해제는 활동 이력에 남으며 민감
          증빙 열람 권한과는 별개입니다.
        </p>
        <div className="library-actions">
          {scopes.map((scope) => (
            <button
              key={scope.unit_id}
              disabled={busy}
              aria-pressed={scope.enabled}
              className={scope.enabled ? "primary" : ""}
              onClick={() => void toggle(scope)}
            >
              {scope.name} · {scope.enabled ? "권한 해제" : "자료 권한 설정"}
            </button>
          ))}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </details>
    </section>
  );
}
