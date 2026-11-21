import type { CalendarEvent, CalendarPreferences } from "./api";
import EventChip from "./EventChip";
import { dayOf, eventKey, overlapsDay, weekNumber } from "./dates";

type Props = {
  days: string[];
  anchor: string;
  today: string;
  selected: string;
  events: CalendarEvent[];
  preferences: CalendarPreferences;
  canCreate: boolean;
  onAdd: (day: string) => void;
  onOpen: (event: CalendarEvent) => void;
  onContext: (e: React.MouseEvent, day: string, event?: CalendarEvent) => void;
  onDrop: (e: React.DragEvent, day: string, minutes?: number) => void;
};
export default function MonthGrid({
  days,
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
}: Props) {
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
      {weeks.map((week) => {
        const bars = spanning
          .map((event) => ({
            event,
            indices: week
              .map((d, i) => (overlapsDay(event, d, preferences.zone) ? i : -1))
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
          while (occupied[lane]?.some((i) => item.indices.includes(i))) lane++;
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
                    onContextMenu={(e) => onContext(e, week[indices[0]], event)}
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
  );
}
