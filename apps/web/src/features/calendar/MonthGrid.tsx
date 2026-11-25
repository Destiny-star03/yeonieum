import { useLayoutEffect, useRef, useState } from "react";
import type { CalendarPreferences, DisplayedCalendarEvent } from "./api";
import EventChip from "./EventChip";
import {
  dayOf,
  eventKey,
  overlapsDay,
  shiftDay,
  weekNumber,
  weekOffset,
} from "./dates";

export type MonthScrollPosition = { week: string; fraction: number };
type Props = {
  days: string[];
  windowStart: string;
  position: MonthScrollPosition;
  anchor: string;
  today: string;
  selected: string;
  events: DisplayedCalendarEvent[];
  preferences: CalendarPreferences;
  canCreate: boolean;
  onAdd: (day: string) => void;
  onOpen: (event: DisplayedCalendarEvent) => void;
  onContext: (
    e: React.MouseEvent,
    day: string,
    event?: DisplayedCalendarEvent,
  ) => void;
  onDrop: (e: React.DragEvent, day: string, minutes?: number) => void;
  onScrollWeek: (position: MonthScrollPosition, centerWeek: string) => void;
  onBlankClick?: () => void;
};
export default function MonthGrid({
  days,
  windowStart,
  position,
  anchor,
  today,
  selected,
  events,
  preferences,
  canCreate,
  onAdd,
  onOpen,
  onContext,
  onDrop,
  onScrollWeek,
  onBlankClick,
}: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const pointer = useRef<{
    id: number;
    x: number;
    y: number;
    dragging: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const rowHeight = useRef(0);
  const snapTimer = useRef<number | undefined>(undefined);
  const snapFrame = useRef<number | undefined>(undefined);

  function stopWeekSnap() {
    window.clearTimeout(snapTimer.current);
    if (snapFrame.current !== undefined) {
      window.cancelAnimationFrame(snapFrame.current);
      snapFrame.current = undefined;
    }
  }

  function snapToWeek() {
    const element = viewport.current;
    const height = rowHeight.current;
    if (!element || !height || pointer.current?.dragging) return;
    const week = element.children.item(Math.round(element.scrollTop / height));
    if (!week) return;
    const distance =
      week.getBoundingClientRect().top - element.getBoundingClientRect().top;
    if (Math.abs(distance) <= 1) return;
    const start = element.scrollTop;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      element.scrollTop = start + distance;
      return;
    }
    const startedAt = performance.now();
    const animate = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - startedAt) / 200));
      const eased = (1 - Math.cos(progress * Math.PI)) / 2;
      element.scrollTop = start + distance * eased;
      snapFrame.current =
        progress < 1 ? window.requestAnimationFrame(animate) : undefined;
    };
    snapFrame.current = window.requestAnimationFrame(animate);
  }

  function scheduleWeekSnap() {
    window.clearTimeout(snapTimer.current);
    if (!pointer.current?.dragging && snapFrame.current === undefined)
      snapTimer.current = window.setTimeout(snapToWeek, 45);
  }

  useLayoutEffect(() => {
    const element = viewport.current;
    const row = element?.firstElementChild;
    if (!element || !row) return;
    const size = () =>
      element.firstElementChild?.getBoundingClientRect().height || 0;
    rowHeight.current = size();
    element.scrollTop =
      (weekOffset(windowStart, position.week) + position.fraction) *
      rowHeight.current;
    const observer = new ResizeObserver(() => {
      const height = size();
      if (!height || height === rowHeight.current) return;
      stopWeekSnap();
      const weeksScrolled = rowHeight.current
        ? element.scrollTop / rowHeight.current
        : 0;
      rowHeight.current = height;
      element.scrollTop = weeksScrolled * height;
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      stopWeekSnap();
    };
  }, [windowStart, position]);
  function endDrag() {
    const active = pointer.current;
    pointer.current = null;
    if (!active?.dragging) {
      scheduleWeekSnap();
      return;
    }
    setDragging(false);
    stopWeekSnap();
    snapToWeek();
  }
  const columns = preferences.weekends ? 7 : 5;
  const weeks = Array.from({ length: days.length / columns }, (_, i) =>
    days.slice(i * columns, (i + 1) * columns),
  );
  const weekday = ["일", "월", "화", "수", "목", "금", "토"];
  const spanning = events.filter(
    (e) =>
      e.all_day ||
      dayOf(e.starts_at, preferences.zone) !==
        dayOf(
          new Date(Date.parse(e.ends_at) - 1).toISOString(),
          preferences.zone,
        ),
  );
  return (
    <div
      className={`notion-month ${preferences.compact ? "is-compact" : ""}`}
      aria-label="월간 일정"
    >
      <div
        className="notion-month-weekdays"
        style={{ gridTemplateColumns: `repeat(${columns},minmax(0,1fr))` }}
      >
        {days.slice(0, columns).map((day) => (
          <span key={day}>
            {weekday[new Date(`${day}T12:00Z`).getUTCDay()]}
          </span>
        ))}
      </div>
      <div
        ref={viewport}
        className={`notion-month-scroll ${dragging ? "is-dragging" : ""}`}
        role="region"
        aria-label="월간 일정 스크롤"
        tabIndex={0}
        onWheel={() => {
          stopWeekSnap();
          scheduleWeekSnap();
        }}
        onScroll={(e) => {
          const height = rowHeight.current;
          if (!height || e.target !== e.currentTarget) return;
          const offset = e.currentTarget.scrollTop / height;
          const index = Math.floor(offset + 1 / height);
          const centerIndex = Math.floor(
            offset + (e.currentTarget.clientHeight / 2 + 1) / height,
          );
          onScrollWeek(
            {
              week: shiftDay(windowStart, index * 7),
              fraction: Math.max(0, offset - index),
            },
            shiftDay(windowStart, centerIndex * 7),
          );
          scheduleWeekSnap();
        }}
        onPointerDown={(e) => {
          suppressClick.current = false;
          stopWeekSnap();
          if (
            e.button !== 0 ||
            e.pointerType !== "mouse" ||
            (e.target as HTMLElement).closest(
              "button, a, input, [draggable=true]",
            )
          )
            return;
          pointer.current = {
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            dragging: false,
          };
        }}
        onPointerMove={(e) => {
          const active = pointer.current;
          if (!active || active.id !== e.pointerId) return;
          if (!(e.buttons & 1)) {
            endDrag();
            return;
          }
          const delta = e.clientY - active.y;
          if (!active.dragging) {
            if (
              Math.abs(delta) < 7 ||
              Math.abs(delta) < Math.abs(e.clientX - active.x)
            )
              return;
            active.dragging = true;
            suppressClick.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging(true);
          }
          e.preventDefault();
          e.currentTarget.scrollTop += delta;
          active.y = e.clientY;
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onClickCapture={(e) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            e.preventDefault();
            e.stopPropagation();
          } else if (
            onBlankClick &&
            !(e.target as HTMLElement).closest(".calendar-event")
          ) {
            e.preventDefault();
            e.stopPropagation();
            onBlankClick();
          }
        }}
      >
        {weeks.map((week) => {
          const bars = spanning
            .map((event) => ({
              event,
              indices: week
                .map((d, i) =>
                  overlapsDay(event, d, preferences.zone) ? i : -1,
                )
                .filter((i) => i >= 0),
            }))
            .filter((x) => x.indices.length)
            .sort(
              (a, b) =>
                a.indices[0] - b.indices[0] ||
                b.indices.length - a.indices.length,
            );
          const occupied: number[][] = [];
          const positioned = bars.map((item) => {
            let lane = 0;
            while (occupied[lane]?.some((i) => item.indices.includes(i)))
              lane++;
            occupied[lane] = [...(occupied[lane] || []), ...item.indices];
            return { ...item, lane };
          });
          const height = occupied.length * 22;
          return (
            <div className="notion-month-week" key={week[0]}>
              {preferences.weekNumbers && (
                <span className="cal-week-number">{weekNumber(week[0])}주</span>
              )}
              <div
                className="notion-month-days"
                style={{
                  gridTemplateColumns: `repeat(${columns},minmax(0,1fr))`,
                }}
              >
                {week.map((day) => (
                  <div
                    className={`calendar-day ${day.slice(0, 7) !== anchor.slice(0, 7) ? "is-outside" : ""} ${day === selected ? "is-selected" : ""}`}
                    key={day}
                    data-date={day}
                    onContextMenu={(e) => onContext(e, day)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => onDrop(e, day)}
                    style={{ paddingTop: 36 + height }}
                  >
                    <button
                      className="calendar-day-top"
                      aria-label={`${day} ${canCreate ? "일정 추가" : "일정 보기"}`}
                      onClick={() => onAdd(day)}
                    >
                      <span className={day === today ? "is-today" : ""}>
                        {day.endsWith("-01")
                          ? `${Number(day.slice(5, 7))}월 1`
                          : Number(day.slice(8))}
                      </span>
                      <i aria-hidden="true">＋</i>
                    </button>
                    <div className="calendar-day-events">
                      {events
                        .filter(
                          (e) =>
                            !spanning.includes(e) &&
                            overlapsDay(e, day, preferences.zone),
                        )
                        .map((event) => (
                          <div
                            key={eventKey(event)}
                            onContextMenu={(e) => onContext(e, day, event)}
                          >
                            <EventChip
                              event={event}
                              day={day}
                              onOpen={onOpen}
                              zone={preferences.zone}
                              hour24={preferences.hour24}
                            />
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
              {positioned.length > 0 && (
                <div
                  className="notion-month-bars"
                  style={{
                    gridTemplateColumns: `repeat(${columns},minmax(0,1fr))`,
                    gridTemplateRows: `repeat(${occupied.length},20px)`,
                  }}
                >
                  {positioned.map(({ event, indices, lane }) => (
                    <div
                      key={eventKey(event)}
                      style={{
                        gridColumn: `${indices[0] + 1} / ${indices[indices.length - 1] + 2}`,
                        gridRow: lane + 1,
                      }}
                      onContextMenu={(e) =>
                        onContext(e, week[indices[0]], event)
                      }
                    >
                      <EventChip
                        event={event}
                        day={week[indices[0]]}
                        onOpen={onOpen}
                        bar
                        zone={preferences.zone}
                        hour24={preferences.hour24}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
