type Name =
  | "overview"
  | "documents"
  | "budgets"
  | "handovers"
  | "roles"
  | "activity"
  | "arrow"
  | "logout"
  | "chevron";
const paths: Record<Name, string> = {
  overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  documents:
    "M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M8 12h8 M8 16h5",
  budgets:
    "M4 5h16v15H4z M4 9h16 M8 3v4 M16 3v4 M8 13h2 M14 13h2 M8 17h2 M14 17h2",
  handovers: "M4 7h15 M15 3l4 4-4 4 M20 17H5 M9 13l-4 4 4 4",
  roles:
    "M15 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M17 3a4 4 0 0 1 0 8 M21 21v-2a4 4 0 0 0-3-3.87",
  activity: "M3 12a9 9 0 1 0 3-6.7 M3 3v5h5 M12 7v5l3 2",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  logout: "M9 4H4v16h5 M13 8l4 4-4 4 M8 12h13",
  chevron: "M14 6l-6 6 6 6",
};
export default function WorkspaceIcon({
  name,
  className = "",
}: {
  name: Name;
  className?: string;
}) {
  return (
    <svg
      className={`workspace-icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
