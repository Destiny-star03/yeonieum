import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../shared/api";
import type { CalendarEvent, Reminder } from "../calendar/api";
import WorkspaceIcon from "../workspace/WorkspaceIcon";
import "./notifications.css";

export type NotificationTarget =
  | { kind: "document"; id: string }
  | { kind: "calendar"; id: string; occurrence?: CalendarEvent };

type SharedNotice = {
  id: string;
  kind: "document" | "calendar";
  title: string;
  org_name: string;
  created_at: string;
  read: boolean;
  target: { id: string };
};

type Notice = {
  key: string;
  title: string;
  label: string;
  meta: string;
  at: string;
  unread: boolean;
  target: NotificationTarget;
  acknowledge: () => Promise<unknown>;
};

export const remindersChanged = "yeonieum-reminders-changed";
const dateTime = new Intl.DateTimeFormat("ko-KR", {
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Seoul",
});

export default function NotificationBell({
  onOpenTarget,
}: {
  onOpenTarget: (target: NotificationTarget) => void;
}) {
  const [shared, setShared] = useState<SharedNotice[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState("");
  const [working, setWorking] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const request = useRef(0);

  const refresh = useCallback(async () => {
    const current = ++request.current;
    const [noticeResult, reminderResult] = await Promise.allSettled([
      api<{ items: SharedNotice[] }>("/notifications"),
      api<{ reminders: Reminder[] }>("/calendar/reminders"),
    ]);
    if (current !== request.current) return;
    setShared(
      noticeResult.status === "fulfilled" ? noticeResult.value.items : [],
    );
    setReminders(
      reminderResult.status === "fulfilled"
        ? reminderResult.value.reminders
        : [],
    );
    setLoadError(
      noticeResult.status === "rejected" ||
        reminderResult.status === "rejected",
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 30_000);
    const catchUp = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", catchUp);
    window.addEventListener("focus", catchUp);
    window.addEventListener(remindersChanged, catchUp);
    return () => {
      ++request.current;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", catchUp);
      window.removeEventListener("focus", catchUp);
      window.removeEventListener(remindersChanged, catchUp);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        root.current?.contains(document.activeElement)
      ) {
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items: Notice[] = [
    ...shared.map((notice): Notice => ({
      key: notice.id,
      title: notice.title,
      label: notice.kind === "document" ? "새 자료" : "공유 일정",
      meta: notice.org_name,
      at: notice.created_at,
      unread: !notice.read,
      target: { kind: notice.kind, id: notice.target.id },
      acknowledge: () => api(`/notifications/${notice.id}/read`, {}),
    })),
    ...reminders.map((reminder): Notice => ({
      key: `${reminder.event.id}/${reminder.occurrence_start}/${reminder.minutes}`,
      title: reminder.event.title,
      label: "일정 리마인더",
      meta: `${reminder.event.org_name} · ${reminder.minutes ? `${reminder.minutes}분 전` : "시작할 때"}`,
      at: new Date(
        Date.parse(reminder.event.starts_at) - reminder.minutes * 60_000,
      ).toISOString(),
      unread: true,
      target: {
        kind: "calendar",
        id: reminder.event.id,
        occurrence: reminder.event,
      },
      acknowledge: async () => {
        await api(`/calendar/events/${reminder.event.id}/reminder-read`, {
          occurrence_start: reminder.occurrence_start,
          minutes: reminder.minutes,
        });
        window.dispatchEvent(new Event(remindersChanged));
      },
    })),
  ].sort(
    (left, right) =>
      Number(right.unread) - Number(left.unread) ||
      Date.parse(right.at) - Date.parse(left.at),
  );
  const unread = items.filter((item) => item.unread).length;

  async function activate(item: Notice, visit: boolean) {
    if (working) return;
    setWorking(true);
    setActionError("");
    try {
      if (item.unread) {
        await item.acknowledge();
        await refresh();
      }
      if (visit) {
        setOpen(false);
        onOpenTarget(item.target);
      }
    } catch {
      setActionError("알림을 처리하지 못했습니다. 다시 확인해 주세요.");
      void refresh();
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="workspace-notifications" ref={root}>
      <button
        ref={button}
        type="button"
        className="workspace-notification-trigger"
        aria-label={unread ? `알림, 읽지 않은 알림 ${unread}개` : "알림"}
        aria-expanded={open}
        aria-controls={open ? "workspace-notification-list" : undefined}
        onClick={() => {
          setActionError("");
          if (!open) void refresh();
          setOpen(!open);
        }}
      >
        <WorkspaceIcon name="bell" />
        {unread > 0 && (
          <span className="workspace-notification-count" aria-hidden="true">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <section
          id="workspace-notification-list"
          className="workspace-notification-popover"
          aria-label="알림함"
        >
          <header>
            <h2>알림</h2>
            {unread > 0 && <span>읽지 않음 {unread}개</span>}
          </header>
          {loading && <p role="status">알림을 불러오는 중…</p>}
          {loadError && (
            <p role="status">
              일부 알림을 불러오지 못했습니다.{" "}
              <button type="button" onClick={() => void refresh()}>
                다시 시도
              </button>
            </p>
          )}
          {actionError && <p role="alert">{actionError}</p>}
          {!loading && !loadError && !items.length && (
            <p>받은 알림이 없습니다.</p>
          )}
          <ul>
            {items.map((item) => (
              <li key={item.key} data-unread={item.unread}>
                <button
                  type="button"
                  className="workspace-notification-entry"
                  disabled={working}
                  onClick={() => void activate(item, true)}
                >
                  <span className="workspace-notification-kind">
                    <WorkspaceIcon
                      name={
                        item.target.kind === "document"
                          ? "documents"
                          : "overview"
                      }
                    />
                    {item.label}
                  </span>
                  <strong>{item.title}</strong>
                  <small>
                    {item.meta} ·{" "}
                    <time dateTime={item.at}>
                      {dateTime.format(new Date(item.at))}
                    </time>
                  </small>
                </button>
                {item.unread && (
                  <button
                    type="button"
                    className="workspace-notification-read"
                    aria-label={`${item.title} 읽음으로 표시`}
                    title="읽음으로 표시"
                    disabled={working}
                    onClick={() => void activate(item, false)}
                  >
                    ✓
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
