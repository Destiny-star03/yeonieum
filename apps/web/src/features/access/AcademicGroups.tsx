import type { SharingGroup } from "../../shared/api";
export default function AcademicGroups({ groups }: { groups: SharingGroup[] }) {
  if (!groups.length) return null;
  return (
    <section className="panel academic-groups">
      <h2>학과협의회·학과별 그룹</h2>
      <p className="muted">
        자료실에서 사용할 공유 대상을 구분합니다. 간부진 그룹 참여와 다른 학과의
        계정·연락처 관리 권한은 별개입니다.
      </p>
      <div className="academic-group-grid">
        {groups.map((group) => (
          <details
            key={group.key}
            className="academic-group"
            data-group-key={group.key}
            open={group.kind === "council_officers"}
          >
            <summary>
              {group.label}
              <span>{group.members.length}명</span>
            </summary>
            <p className="muted">
              {group.kind === "council_officers"
                ? "학회장·부학회장 공유 대상"
                : "해당 학과 학회장·부학회장·반대표 공유 대상"}
            </p>
            <ul>
              {group.members.map((member) => (
                <li key={member.user_id}>
                  <strong>
                    {member.name}{" "}
                    {member.is_chair && (
                      <span className="chair-badge">의장</span>
                    )}
                  </strong>
                  <small>
                    {member.department_names.join(" · ")} ·{" "}
                    {member.roles.join(" · ")}
                  </small>
                </li>
              ))}
            </ul>
            {!group.members.length && (
              <p className="muted">현재 유효한 담당자가 없습니다.</p>
            )}
          </details>
        ))}
      </div>
    </section>
  );
}
