import type { CalendarEvent } from "./api";
import { dayOf, displayTime, tone } from "./dates";
export type CalendarDrag = {
  id: string;
  start: string;
  operation: "move" | "resize";
};
export function beginEventDrag(
  e: React.DragEvent,
  event: CalendarEvent,
  operation: "move" | "resize" = "move",
) {
  if (!event.can_edit) {
    e.preventDefault();
    return;
  }
  e.stopPropagation();
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData(
    "application/yeonieum-event",
    JSON.stringify({
      id: event.id,
      start: event.starts_at,
      operation,
    } satisfies CalendarDrag),
  );
}
export default function EventChip({
  event,
  day,
  onOpen,
  zone = "Asia/Seoul",
  hour24 = true,
  bar = false,
}: {
  event: CalendarEvent;
  day: string;
  onOpen: (event: CalendarEvent) => void;
  zone?: string;
  hour24?: boolean;
  bar?: boolean;
}) {
  return (
    <button
      className={`calendar-event calendar-tone-${tone(event.org_id)} cal-color-${event.color || "default"} ${bar || event.all_day ? "is-bar" : "is-timed"} ${event.availability === "free" ? "is-free" : ""}`}
      aria-label={`${event.title} 일정 열기 · ${day}`}
      title={`${event.title} · ${event.unit_name}`}
      draggable={event.can_edit}
      onDragStart={(e) => beginEventDrag(e, event)}
      onClick={() => onOpen(event)}
    >
      <span className="calendar-event-time">
        {event.all_day
          ? ""
          : dayOf(event.starts_at, zone) !== day
            ? "계속"
            : displayTime(event.starts_at, hour24, zone)}
      </span>
      <strong>{event.title}</strong>
      {event.recurrence && (
        <span className="cal-repeat-mark" aria-label="반복 일정">
          ↻
        </span>
      )}
    </button>
  );
}
