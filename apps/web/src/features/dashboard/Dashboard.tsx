import QuickStart from "./QuickStart";
import CalendarWorkspace from "../calendar/CalendarWorkspace";
import type { Workspace } from "../../shared/api";

type Props = { workspace: Workspace; onNavigate: (tab: string) => void };
export default function Dashboard({ workspace, onNavigate }: Props) {
  return (
    <div className="reference-dashboard">
      <QuickStart onNavigate={onNavigate} />
      <CalendarWorkspace time={workspace.server_time} />
    </div>
  );
}
