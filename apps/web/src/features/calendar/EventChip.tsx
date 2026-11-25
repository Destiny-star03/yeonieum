import type { CalendarEvent, DisplayedCalendarEvent } from "./api";
import { dayOf, displayTime, tone } from "./dates";
export type CalendarDrag = {
  id: string;
  revision: number;
  start: string;
  end: string;
  occurrenceStart: string;
  operation: "move" | "resize";
};
export type DropChange = {
  event: CalendarEvent;
  operation: CalendarDrag["operation"];
  occurrenceStart: string;
  previousStart: number;
  previousEnd: number;
  day: string;
  starts: number;
  ends: number;
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
      revision: event.revision,
      start: event.starts_at,
      end: event.ends_at,
      occurrenceStart: event.occurrence_start || event.starts_at,
      operation,
    } satisfies CalendarDrag),
  );
}
export function eventActionLabel(event: DisplayedCalendarEvent, day: string) {
  const action = event.pendingMove ? "저장 전 변경 확인" : "일정 열기";
  return `${event.title} ${action} · ${day}`;
}
export default function EventChip({
  event,
  day,
  onOpen,
  zone = "Asia/Seoul",
  hour24 = true,
  bar = false,
}: {
  event: DisplayedCalendarEvent;
  day: string;
  onOpen: (event: DisplayedCalendarEvent) => void;
  zone?: string;
  hour24?: boolean;
  bar?: boolean;
}) {
  return (
    <button
      className={`calendar-event calendar-tone-${tone(event.displayCalendar?.org_id || event.org_id)} cal-color-${event.displayColor || event.color || "default"} ${bar || event.all_day ? "is-bar" : "is-timed"} ${event.availability === "free" ? "is-free" : ""}`}
      aria-label={eventActionLabel(event, day)}
      data-pending-move={event.pendingMove}
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
      {event.pendingMove && (
        <i className="cal-pending-dot" aria-hidden="true" />
      )}
      <strong>{event.title}</strong>
      {event.recurrence && (
        <span className="cal-repeat-mark" aria-label="반복 일정">
          ↻
        </span>
      )}
    </button>
  );
}
