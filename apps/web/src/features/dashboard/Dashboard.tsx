import QuickStart from "./QuickStart";
import CalendarWorkspace from "../calendar/CalendarWorkspace";
import type { NotificationTarget } from "../notifications/NotificationBell";
import type { Workspace } from "../../shared/api";

type Props = {
  workspace: Workspace;
  userId: string;
  onNavigate: (tab: string) => void;
  notification: Extract<NotificationTarget, { kind: "calendar" }> | null;
};
export default function Dashboard({
  workspace,
  userId,
  onNavigate,
  notification,
}: Props) {
  return (
    <div className="reference-dashboard">
      <QuickStart onNavigate={onNavigate} />
      <CalendarWorkspace
        key={userId}
        time={workspace.server_time}
        userId={userId}
        notification={notification}
      />
    </div>
  );
}
