import { useEffect, useRef, type CSSProperties } from "react";
import type { CalendarPreferences, DisplayedCalendarEvent, Draft } from "./api";
import EventChip, { beginEventDrag, eventActionLabel } from "./EventChip";
import {
  atMidnight,
  dayOf,
  eventKey,
  localFields,
  minuteTime,
  overlapsDay,
  shiftDay,
  tone,
} from "./dates";

type Props = {
  days: string[];
  today: string;
  events: DisplayedCalendarEvent[];
  preferences: CalendarPreferences;
  onAdd: (draft: Draft) => void;
  onOpen: (event: DisplayedCalendarEvent) => void;
  onContext: (
    e: React.MouseEvent,
    day: string,
    event?: DisplayedCalendarEvent,
  ) => void;
  onDrop: (e: React.DragEvent, day: string, minute?: number) => void;
  label: string;
};
const scale = 52 / 60;
function positioned(
  events: DisplayedCalendarEvent[],
  day: string,
  zone: string,
) {
  const start = Date.parse(atMidnight(day, zone));
  const rows = events
    .filter((e) => !e.all_day && overlapsDay(e, day, zone))
    .map((event) => ({
      event,
      start: Math.max(0, (Date.parse(event.starts_at) - start) / 60000),
      end: Math.min(1440, (Date.parse(event.ends_at) - start) / 60000),
      lane: 0,
      count: 1,
    }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster: typeof rows = [],
    maxEnd = -1;
  function finish() {
    const lanes: number[] = [];
    for (const row of cluster) {
      let i = lanes.findIndex((end) => end <= row.start);
      if (i < 0) i = lanes.length;
      row.lane = i;
      lanes[i] = row.end;
    }
    for (const row of cluster) row.count = lanes.length;
    cluster = [];
  }
  for (const row of rows) {
    if (row.start >= maxEnd) {
      finish();
      maxEnd = -1;
    }
    cluster.push(row);
    maxEnd = Math.max(maxEnd, row.end);
  }
  finish();
  return rows;
}
export default function TimeGrid({
  days,
  today,
  events,
  preferences,
  onAdd,
  onOpen,
  onContext,
  onDrop,
  label,
}: Props) {
  const scroll = useRef<HTMLDivElement>(null);
  const range = useRef<{ day: string; start: number; end: number } | null>(
    null,
  );
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 8 * 52;
  }, [days[0]]);
  function finish() {
    const value = range.current;
    if (!value) return;
    range.current = null;
    const first = Math.min(value.start, value.end),
      last = Math.max(value.start, value.end) + 30;
    onAdd({
      day: value.day,
      startTime: minuteTime(first),
      endDay: last === 1440 ? shiftDay(value.day, 1) : value.day,
      endTime: minuteTime(last === 1440 ? 0 : last),
      allDay: false,
    });
  }
  const now = localFields(new Date().toISOString(), preferences.zone);
  const nowMinute =
    Number(now.time.slice(0, 2)) * 60 + Number(now.time.slice(3));
  return (
    <div
      className="calendar-time-grid"
      aria-label={label}
      style={{ "--time-min": `${45 + days.length * 100}px` } as CSSProperties}
    >
      <div
        className="cal-time-head"
        style={{
          gridTemplateColumns: `45px repeat(${days.length},minmax(0,1fr))`,
        }}
      >
        <span className="cal-time-zone-label">
          {preferences.zone === "UTC" ? "UTC" : "GMT+9"}
        </span>
        {days.map((day) => (
          <button
            key={day}
            onClick={() => onAdd({ day })}
            aria-label={`${day} 일정 추가`}
          >
            <small>
              {new Intl.DateTimeFormat("ko-KR", {
                timeZone: "UTC",
                weekday: "short",
              }).format(new Date(`${day}T12:00Z`))}
            </small>
            <strong className={day === today ? "is-today" : ""}>
              {Number(day.slice(8))}
            </strong>
          </button>
        ))}
      </div>
      <div
        className="cal-all-day"
        style={{
          gridTemplateColumns: `45px repeat(${days.length},minmax(0,1fr))`,
        }}
      >
        <span>종일</span>
        {days.map((day) => (
          <div
            key={day}
            onDoubleClick={() => onAdd({ day, allDay: true })}
            onContextMenu={(e) => onContext(e, day)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDrop(e, day)}
          >
            {events
              .filter((e) => e.all_day && overlapsDay(e, day))
              .map((event) => (
                <EventChip
                  key={eventKey(event)}
                  event={event}
                  day={day}
                  onOpen={onOpen}
                  bar
                  zone={preferences.zone}
                  hour24={preferences.hour24}
                />
              ))}
          </div>
        ))}
      </div>
      <div ref={scroll} className="cal-time-scroll">
        <div
          className="cal-time-columns"
          style={{
            gridTemplateColumns: `45px repeat(${days.length},minmax(0,1fr))`,
          }}
        >
          <div className="cal-hour-labels">
            {Array.from({ length: 24 }, (_, hour) => (
              <span style={{ top: hour * 52 }} key={hour}>
                {preferences.hour24
                  ? `${hour.toString().padStart(2, "0")}:00`
                  : `${hour < 12 ? "오전" : "오후"} ${hour % 12 || 12}`}
              </span>
            ))}
          </div>
          {days.map((day) => (
            <div
              className="cal-time-track"
              key={day}
              data-date={day}
              onPointerUp={finish}
              onPointerLeave={() => {
                range.current = null;
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                onDrop(
                  e,
                  day,
                  Math.max(
                    0,
                    Math.min(
                      1425,
                      Math.round((e.clientY - rect.top) / scale / 15) * 15,
                    ),
                  ),
                );
              }}
              onContextMenu={(e) => onContext(e, day)}
            >
              {Array.from({ length: 48 }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  className="cal-time-slot"
                  tabIndex={-1}
                  aria-label={`${day} ${minuteTime(i * 30)} 일정 추가`}
                  onPointerDown={(e) => {
                    if (e.button === 0) {
                      range.current = { day, start: i * 30, end: i * 30 };
                      e.preventDefault();
                    }
                  }}
                  onPointerEnter={(e) => {
                    if (e.buttons === 1 && range.current?.day === day)
                      range.current.end = i * 30;
                  }}
                  onClick={(e) => {
                    if (e.detail === 0)
                      onAdd({
                        day,
                        startTime: minuteTime(i * 30),
                        endTime: minuteTime(
                          (i + 1) * 30 === 1440 ? 0 : (i + 1) * 30,
                        ),
                        endDay: i === 47 ? shiftDay(day, 1) : day,
                      });
                  }}
                />
              ))}
              {positioned(events, day, preferences.zone).map(
                ({ event, start, end, lane, count }) => (
                  <div
                    className={`cal-timed-block calendar-tone-${tone(event.displayCalendar?.org_id || event.org_id)} cal-color-${event.displayColor || event.color || "default"} ${event.availability === "free" ? "is-free" : ""} ${end - start < 45 ? "is-short" : ""}`}
                    key={eventKey(event)}
                    style={{
                      top: start * scale,
                      height: Math.max(21, (end - start) * scale),
                      left: `calc(${(lane / count) * 100}% + 2px)`,
                      width: `calc(${100 / count}% - 4px)`,
                    }}
                  >
                    <button
                      aria-label={eventActionLabel(event, day)}
                      data-pending-move={event.pendingMove}
                      title={`${event.title} · ${localFields(event.starts_at, preferences.zone).time}–${localFields(event.ends_at, preferences.zone).time}`}
                      draggable={event.can_edit}
                      onDragStart={(e) => beginEventDrag(e, event)}
                      onContextMenu={(e) => onContext(e, day, event)}
                      onClick={() => onOpen(event)}
                    >
                      <strong>
                        {event.pendingMove && (
                          <i className="cal-pending-dot" aria-hidden="true" />
                        )}
                        {event.title}
                        {event.recurrence ? " ↻" : ""}
                      </strong>
                      <small>
                        {localFields(event.starts_at, preferences.zone).time}–
                        {localFields(event.ends_at, preferences.zone).time}
                      </small>
                    </button>
                    {event.can_edit && (
                      <span
                        className="cal-resize-handle"
                        role="button"
                        aria-label={`${event.title} 종료 시간 변경`}
                        tabIndex={-1}
                        draggable
                        onDragStart={(e) => beginEventDrag(e, event, "resize")}
                      />
                    )}
                  </div>
                ),
              )}
              {day === now.day && (
                <div
                  className="cal-now-line"
                  style={{ top: nowMinute * scale }}
                >
                  <i />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
