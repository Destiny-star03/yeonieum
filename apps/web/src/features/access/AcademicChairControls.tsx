import type { Assignment, Workspace } from "../../shared/api";
type Props = {
  assignment: Assignment;
  workspace: Workspace;
  admin: boolean;
  onAppoint: (head: Assignment) => void;
  onRevoke: (role: Assignment) => void;
};
export default function AcademicChairControls({
  assignment,
  workspace,
  admin,
  onAppoint,
  onRevoke,
}: Props) {
  if (assignment.role !== "department_head") return null;
  const chair = workspace.assignments.find(
    (a) =>
      a.role === "chair" &&
      a.prerequisite_id === assignment.id &&
      !a.revoked_at,
  );
  const person =
    workspace.users.find((p) => p.id === assignment.user_id)?.name || "학회장";
  return (
    <div className="academic-chair-controls">
      {chair && (
        <span className="chair-badge">
          {chair.effective ? "의장" : "의장 (비활성)"}
        </span>
      )}
      {admin && chair && (
        <button
          className="text-button"
          aria-label={`${person} 의장 해제`}
          onClick={() => onRevoke(chair)}
        >
          의장 해제
        </button>
      )}
      {admin && !chair && assignment.effective && (
        <button
          className="text-button"
          aria-label={`${person} 의장 지정`}
          onClick={() => onAppoint(assignment)}
        >
          의장 지정
        </button>
      )}
    </div>
  );
}
