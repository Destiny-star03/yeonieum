import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from "react";
import {
  api,
  eventCalendars,
  type CalendarUnit,
  type CalendarEvent,
  type DisplayedCalendarEvent,
  type Draft,
  type CalendarPreferences,
  type View,
  type Reminder,
  type OccurrenceScope,
} from "./api";
import EventDialog from "./EventDialog";
import { CalendarScopeRow } from "./ColorPicker";
import {
  calendarColorHex,
  isCalendarColor,
  type CalendarColor,
} from "./calendarColors";
import RepeatChangeDialog from "./RepeatChangeDialog";
import {
  useExternalCalendars,
  ExternalSources,
  ExternalEventDetail,
} from "./ExternalCalendars";
import MonthGrid, { type MonthScrollPosition } from "./MonthGrid";
import TimeGrid from "./TimeGrid";
import { MiniCalendar, CommandPalette, ShortcutHelp } from "./CalendarTools";
import type { CalendarDrag, DropChange } from "./EventChip";
import {
  atMidnight,
  dayOf,
  daysForWeeks,
  displayTime,
  eventKey,
  localInstant,
  longDay,
  minuteTime,
  monthBufferWeeks,
  monthVisibleWeeks,
  monthWeekStart,
  overlapsDay,
  moveMonth,
  shiftDay,
  tone,
  visibleDayRange,
  weekOffset,
} from "./dates";
import WorkspaceIcon from "../workspace/WorkspaceIcon";
import {
  remindersChanged,
  type NotificationTarget,
} from "../notifications/NotificationBell";
import "./calendar.css";

const defaults: CalendarPreferences = {
  dayCount: 7,
  weekends: true,
  weekNumbers: false,
  hour24: true,
  compact: false,
  zone: "Asia/Seoul",
};
function loadPreferences() {
  try {
    const saved = JSON.parse(
      localStorage.getItem("yeonieum-calendar-settings") || "{}",
    );
    return {
      ...defaults,
      dayCount: [3, 4, 5, 7].includes(saved.dayCount) ? saved.dayCount : 7,
      weekends: saved.weekends !== false,
      weekNumbers: saved.weekNumbers === true,
      hour24: saved.hour24 !== false,
      compact: saved.compact === true,
      zone: saved.zone === "UTC" ? "UTC" : "Asia/Seoul",
    } as CalendarPreferences;
  } catch {
    return defaults;
  }
}

function loadOrganizationColors(storageKey: string) {
  const colors = new Map<string, CalendarColor>();
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || "{}");
    if (saved && typeof saved === "object" && !Array.isArray(saved))
      for (const [orgId, color] of Object.entries(saved))
        if (isCalendarColor(color)) colors.set(orgId, color);
  } catch {
    /* Colors remain available when browser storage cannot be read. */
  }
  return colors;
}

type Context = { x: number; y: number; day: string; event?: CalendarEvent };
type RepeatChange = {
  change: DropChange;
  scope: OccurrenceScope;
  mode: "new" | "pending" | "review";
};
function monthWindowFor(position: MonthScrollPosition) {
  return { start: shiftDay(position.week, -monthBufferWeeks * 7), position };
}
const monthWindowWeeks = monthVisibleWeeks + monthBufferWeeks * 2;

export default function CalendarWorkspace({
  time,
  userId,
  notification,
}: {
  time: string;
  userId: string;
  notification: Extract<NotificationTarget, { kind: "calendar" }> | null;
}) {
  const [preferences, setPreferences] =
    useState<CalendarPreferences>(loadPreferences);
  const colorStorageKey = `yeonieum-calendar-colors-${userId}`;
  const [organizationColors, setOrganizationColors] = useState(() =>
    loadOrganizationColors(colorStorageKey),
  );
  const today = dayOf(time, preferences.zone);
  const [anchor, setAnchor] = useState(today),
    [selected, setSelected] = useState(today),
    [view, setView] = useState<View>("month");
  const [monthFirstWeek, setMonthFirstWeek] = useState(() =>
    monthWeekStart(today),
  );
  const [monthHeadingDay, setMonthHeadingDay] = useState(today);
  const retainEventsOnRangeChange = useRef(false);
  const [monthWindow, setMonthWindow] = useState(() =>
    monthWindowFor({ week: monthWeekStart(today), fraction: 0 }),
  );
  const [units, setUnits] = useState<CalendarUnit[]>([]),
    [events, setEvents] = useState<CalendarEvent[]>([]),
    [checked, setChecked] = useState<Set<string> | null>(null);
  const [loading, setLoading] = useState(true),
    [hasLoaded, setHasLoaded] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [reload, setReload] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null),
    [dirty, setDirty] = useState(false),
    [panel, setPanel] = useState(
      () => window.matchMedia("(min-width:1101px)").matches,
    ),
    [panelForced, setPanelForced] = useState(false),
    [sidebar, setSidebar] = useState(true),
    [expanded, setExpanded] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [repeatChange, setRepeatChange] = useState<RepeatChange | null>(null);
  const [repeatSaving, setRepeatSaving] = useState(false);
  const [repeatError, setRepeatError] = useState("");
  const dropInProgress = useRef(false);
  const [externalSelected, setExternalSelected] =
    useState<CalendarEvent | null>(null);
  const [hiddenExternal, setHiddenExternal] = useState<Set<string>>(new Set());
  const dismissPointer = useRef(false);
  const [context, setContext] = useState<Context | null>(null),
    [clipboard, setClipboard] = useState<CalendarEvent | null>(null),
    [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [query, setQuery] = useState(""),
    [searching, setSearching] = useState(false),
    [searchResults, setSearchResults] = useState<CalendarEvent[]>([]),
    [searchError, setSearchError] = useState(""),
    [moreResults, setMoreResults] = useState(false);
  const [reminders, setReminders] = useState<Reminder[]>([]),
    [remindersOpen, setRemindersOpen] = useState(false),
    [reminderError, setReminderError] = useState("");
  const [commands, setCommands] = useState(false),
    [jump, setJump] = useState(false),
    [jumpDay, setJumpDay] = useState(today);
  const root = useRef<HTMLElement>(null),
    addButton = useRef<HTMLButtonElement>(null),
    searchInput = useRef<HTMLInputElement>(null),
    jumpDialog = useRef<HTMLDialogElement>(null),
    lastDraft = useRef(false);
  const days = useMemo(
    () =>
      view === "month"
        ? daysForWeeks(
            monthWindow.start,
            monthWindowWeeks,
            preferences.weekends,
          )
        : visibleDayRange(
            anchor,
            view,
            preferences.dayCount,
            preferences.weekends,
          ),
    [
      anchor,
      view,
      monthWindow.start,
      preferences.dayCount,
      preferences.weekends,
    ],
  );
  const start = days[0],
    end = shiftDay(days[days.length - 1], 1);
  const repeatMode = repeatChange?.mode;
  const hasRepeatChange = repeatChange !== null;
  const pendingRepeat =
    repeatChange && repeatChange.mode !== "new" ? repeatChange.change : null;
  const reviewingRepeat = repeatMode === "pending" ? null : repeatChange;
  const external = useExternalCalendars(
    new URLSearchParams({
      start: atMidnight(start, preferences.zone),
      end: atMidnight(end, preferences.zone),
    }).toString(),
    reload,
    view === "month",
  );
  useEffect(() => {
    if (!external.loading && !external.error)
      setExternalSelected((current) => {
        if (!current) return null;
        const refreshed = external.events.find(
          (event) => event.id === current.id,
        );
        if (refreshed) return refreshed;
        return view === "month" &&
          !days.some((day) => overlapsDay(current, day, preferences.zone))
          ? current
          : null;
      });
  }, [
    external.events,
    external.loading,
    external.error,
    days,
    preferences.zone,
    view,
  ]);
  useEffect(() => {
    try {
      localStorage.setItem(
        "yeonieum-calendar-settings",
        JSON.stringify(preferences),
      );
    } catch {
      /* Settings still work without browser storage. */
    }
  }, [preferences]);
  useEffect(() => {
    try {
      localStorage.setItem(
        colorStorageKey,
        JSON.stringify(Object.fromEntries(organizationColors)),
      );
    } catch {
      /* The active calendar can still use the selected colors. */
    }
  }, [colorStorageKey, organizationColors]);
  useEffect(() => {
    if (!expanded) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = old;
    };
  }, [expanded]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty || hasRepeatChange) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, hasRepeatChange]);
  useEffect(() => {
    let frame: number | undefined;
    if (lastDraft.current && !draft)
      frame = requestAnimationFrame(() => {
        const target = addButton.current?.disabled
          ? root.current
          : addButton.current;
        target?.focus({ preventScroll: true });
      });
    lastDraft.current = Boolean(draft);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [draft]);
  useEffect(() => {
    if (repeatMode !== "pending") return;
    const frame = requestAnimationFrame(() => {
      const previews = root.current?.querySelectorAll<HTMLButtonElement>(
        "button[data-pending-move]",
      );
      const target =
        previews &&
        Array.from(previews).find((preview) => preview.getClientRects().length);
      (target || root.current)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [repeatMode]);
  useEffect(() => {
    let alive = true;
    if (!retainEventsOnRangeChange.current) setEvents([]);
    retainEventsOnRangeChange.current = false;
    setLoading(true);
    setError("");
    Promise.all([
      api<{ units: CalendarUnit[] }>("/calendar/options"),
      api<{ events: CalendarEvent[] }>(
        `/calendar/events?${new URLSearchParams({ start: atMidnight(start, preferences.zone), end: atMidnight(end, preferences.zone) })}`,
      ),
    ])
      .then(([options, result]) => {
        if (alive) {
          setUnits(options.units);
          setEvents(result.events);
          setHasLoaded(true);
        }
      })
      .catch((e) => {
        if (alive) {
          setEvents([]);
          setError((e as Error).message);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [start, end, reload, preferences.zone]);
  useEffect(() => {
    let alive = true;
    async function check() {
      try {
        const data = await api<{ reminders: Reminder[] }>(
          "/calendar/reminders",
        );
        if (alive) {
          setReminders(data.reminders);
          setReminderError("");
        }
      } catch (e) {
        if (alive) setReminderError((e as Error).message);
      }
    }
    void check();
    const id = setInterval(() => void check(), 60000);
    window.addEventListener(remindersChanged, check);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener(remindersChanged, check);
    };
  }, [reload]);
  useEffect(() => {
    let alive = true;
    setSearchResults([]);
    setSearchError("");
    if (!query.trim()) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const id = setTimeout(() => {
      api<{ events: CalendarEvent[]; has_more: boolean }>(
        `/calendar/search?${new URLSearchParams({ q: query.trim() })}`,
      )
        .then((result) => {
          if (alive) {
            setSearchResults(result.events);
            setMoreResults(result.has_more);
          }
        })
        .catch((e) => {
          if (alive) setSearchError((e as Error).message);
        })
        .finally(() => {
          if (alive) setSearching(false);
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [query, reload]);
  useEffect(() => {
    if (jump) {
      setJumpDay(selected);
      jumpDialog.current?.showModal();
    } else jumpDialog.current?.close();
  }, [jump]);
  useEffect(() => {
    if (!context) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest(".cal-context-menu"))
        setContext(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [context]);
  const orgs = Array.from(
    new Map(
      units.map((u) => [u.org_id, { id: u.org_id, name: u.org_name }]),
    ).values(),
  );
  const preview: DisplayedCalendarEvent | null = pendingRepeat && {
    ...pendingRepeat.event,
    starts_at: new Date(pendingRepeat.starts).toISOString(),
    ends_at: new Date(pendingRepeat.ends).toISOString(),
    occurrence_start: pendingRepeat.occurrenceStart,
    instance_key: `${pendingRepeat.event.id}@${pendingRepeat.occurrenceStart}`,
    pendingMove: true,
  };
  const visible: DisplayedCalendarEvent[] = [
    ...events.filter((event) => eventKey(event) !== preview?.instance_key),
    ...(preview &&
    days.some((day) => overlapsDay(preview, day, preferences.zone))
      ? [preview]
      : []),
  ].flatMap((event) => {
    const displayCalendar = eventCalendars(event).find(
      (target) => checked === null || checked.has(target.org_id),
    );
    if (!displayCalendar) return [];
    return [
      {
        ...event,
        displayCalendar,
        displayColor:
          event.color === "default"
            ? organizationColors.get(displayCalendar.org_id)
            : undefined,
      },
    ];
  });
  visible.push(
    ...external.events.filter((e) => !hiddenExternal.has(e.external_source!)),
  );
  visible.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const agendaDays =
    view === "month"
      ? daysForWeeks(monthFirstWeek, monthVisibleWeeks, preferences.weekends)
      : days;
  const agendaEvents = visible.filter((event) =>
    agendaDays.some((day) => overlapsDay(event, day, preferences.zone)),
  );
  const actionDay =
    view === "month" && !agendaDays.includes(selected)
      ? monthHeadingDay
      : selected;
  const writable = units.filter((u) => u.can_create);
  const defaultTarget =
    writable.find((u) => checked === null || checked.has(u.org_id)) ||
    writable[0];
  const defaultUnit =
    writable.find((u) => u.id === defaultTarget?.org_id)?.id ||
    defaultTarget?.id ||
    "";
  const headingDay = view === "month" ? monthHeadingDay : anchor;
  const monthTitle = `${Number(headingDay.slice(0, 4))}년 ${Number(headingDay.slice(5, 7))}월`;
  const title =
    view === "day" ? `${monthTitle} ${Number(anchor.slice(8))}일` : monthTitle;
  function leave() {
    if (editorBusy) return false;
    return (
      !dirty ||
      window.confirm("저장하지 않은 변경 사항을 버리고 이동하시겠습니까?")
    );
  }
  function hideSmallPanel() {
    if (window.matchMedia("(max-width:1100px)").matches) {
      setPanel(false);
      setPanelForced(false);
    }
  }
  function closeEditor() {
    if (!leave()) return;
    setDirty(false);
    setDraft(null);
    hideSmallPanel();
  }
  function clearCanvasEditor() {
    if (!leave()) return;
    setExternalSelected(null);
    setDirty(false);
    setDraft(null);
    setSelectedEvent(null);
    setContext(null);
    setQuery("");
    setPanel(true);
    setPanelForced(true);
  }
  function add(value: string | Draft) {
    const next = typeof value === "string" ? { day: value } : value;
    setSelected(next.day);
    setNotice("");
    if (writable.length && leave()) {
      setExternalSelected(null);
      setQuery("");
      setDraft(next);
      setPanel(true);
      setPanelForced(true);
      setSelectedEvent(null);
      setDirty(false);
    }
  }
  async function open(
    target: DisplayedCalendarEvent | { id: string },
    focus = false,
  ) {
    if (!leave()) return;
    const displayed = "starts_at" in target ? target : null;
    if (displayed?.pendingMove && repeatChange) {
      setRepeatError("");
      setContext(null);
      setRepeatChange({ ...repeatChange, mode: "review" });
      return;
    }
    if (displayed?.external_source) {
      setDraft(null);
      setDirty(false);
      setExternalSelected(displayed);
      setSelectedEvent(null);
      setContext(null);
      setQuery("");
      setPanel(true);
      setPanelForced(true);
      return;
    }
    setExternalSelected(null);
    setError("");
    setContext(null);
    try {
      const fresh = await api<CalendarEvent>(`/calendar/events/${target.id}`);
      const event = displayed ?? fresh;
      const day = dayOf(
        event.starts_at,
        event.all_day ? "Asia/Seoul" : preferences.zone,
      );
      if (focus) {
        setSelected(day);
        focusDate(day);
      }
      setQuery("");
      setRemindersOpen(false);
      setSelectedEvent(event);
      setDraft({
        day: dayOf(
          fresh.starts_at,
          fresh.all_day ? "Asia/Seoul" : fresh.time_zone,
        ),
        event: fresh,
        occurrenceDay: day,
      });
      setDirty(false);
      setPanel(true);
      setPanelForced(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (notification)
      void open(notification.occurrence ?? { id: notification.id }, true);
  }, [notification]);
  function focusDate(day: string) {
    retainEventsOnRangeChange.current = false;
    setAnchor(day);
    setMonthHeadingDay(day);
    const week = monthWeekStart(day);
    setMonthFirstWeek(week);
    setMonthWindow(monthWindowFor({ week, fraction: 0 }));
  }
  function scrollMonth(position: MonthScrollPosition, centerWeek: string) {
    setMonthFirstWeek(position.week);
    setMonthHeadingDay(shiftDay(centerWeek, 3));
    const index = weekOffset(monthWindow.start, position.week);
    if (index <= 1 || index >= monthWindowWeeks - monthVisibleWeeks - 1) {
      retainEventsOnRangeChange.current = true;
      setMonthWindow(monthWindowFor(position));
    }
  }
  function switchView(next: View) {
    if (
      view === "month" &&
      next !== "month" &&
      monthFirstWeek !== monthWeekStart(anchor)
    )
      focusDate(agendaDays.includes(selected) ? selected : monthHeadingDay);
    setView(next);
  }
  function navigate(direction: number) {
    const next =
      view === "month"
        ? moveMonth(monthHeadingDay, direction)
        : shiftDay(
            anchor,
            direction * (view === "day" ? 1 : preferences.dayCount),
          );
    focusDate(next);
    setSelected(next);
    setNotice("");
  }
  function goToday() {
    focusDate(today);
    setSelected(today);
    setNotice("");
  }
  function toggleOrg(id: string) {
    const next = new Set(checked === null ? orgs.map((o) => o.id) : checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChecked(next);
  }
  function saved(event: CalendarEvent) {
    const selectedDay = draft?.event?.recurrence
      ? draft.occurrenceDay || selected
      : dayOf(event.starts_at, event.all_day ? "Asia/Seoul" : preferences.zone);
    setDirty(false);
    setDraft(null);
    if (view === "month" && agendaDays.includes(selectedDay))
      setAnchor(selectedDay);
    else focusDate(selectedDay);
    setSelected(selectedDay);
    setChecked(
      (current) =>
        current &&
        new Set([
          ...current,
          ...eventCalendars(event).map((target) => target.org_id),
        ]),
    );
    hideSmallPanel();
    setNotice("");
    setReload((r) => r + 1);
  }
  function copy(event: CalendarEvent) {
    if (event.external_source) return;
    setClipboard(event);
    setContext(null);
    setNotice(
      "일정을 복사했습니다. 날짜에서 붙여넣기 또는 Ctrl+V를 사용하세요.",
    );
  }
  function paste(day: string) {
    if (!clipboard || !writable.length || !leave()) return;
    setExternalSelected(null);
    const originalTargets = eventCalendars(clipboard);
    const targets = originalTargets.filter((target) =>
      writable.some((unit) => unit.id === target.unit_id),
    );
    const fallback = writable.find((unit) => unit.id === defaultUnit);
    if (!targets.length && fallback)
      targets.push({
        unit_id: fallback.id,
        unit_name: fallback.name,
        org_id: fallback.org_id,
        org_name: fallback.org_name,
      });
    setQuery("");
    setDraft({
      day,
      copy: {
        ...clipboard,
        calendars: targets,
        participant_ids: originalTargets.every((target) =>
          targets.some((next) => next.unit_id === target.unit_id),
        )
          ? clipboard.participant_ids
          : [],
      },
    });
    setSelected(day);
    setDirty(false);
    setPanel(true);
    setPanelForced(true);
    setContext(null);
  }
  function menu(e: MouseEvent, day: string, event?: DisplayedCalendarEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (event?.external_source || event?.pendingMove) {
      void open(event);
      return;
    }
    setSelected(day);
    setContext({
      x: Math.max(8, Math.min(e.clientX || 200, window.innerWidth - 220)),
      y: Math.max(8, Math.min(e.clientY || 200, window.innerHeight - 240)),
      day,
      event,
    });
  }
  async function drop(e: DragEvent, day: string, minute?: number) {
    e.preventDefault();
    e.stopPropagation();
    const raw = e.dataTransfer.getData("application/yeonieum-event");
    if (!raw || dropInProgress.current || reviewingRepeat || !leave()) return;
    dropInProgress.current = true;
    try {
      const action = JSON.parse(raw) as CalendarDrag;
      if (
        pendingRepeat &&
        (action.id !== pendingRepeat.event.id ||
          action.occurrenceStart !== pendingRepeat.occurrenceStart)
      ) {
        setRepeatError("");
        setRepeatChange((current) => current && { ...current, mode: "review" });
        return;
      }
      const event = await api<CalendarEvent>(`/calendar/events/${action.id}`);
      if (!event.can_edit) return;
      if (event.revision !== action.revision) {
        setError("일정이 변경되었습니다. 다시 불러온 뒤 이동해 주세요.");
        return;
      }
      const draggedStart = Date.parse(action.start);
      const draggedEnd = Date.parse(action.end);
      const previousStart = pendingRepeat?.previousStart ?? draggedStart;
      const previousEnd = pendingRepeat?.previousEnd ?? draggedEnd;
      let starts: number, ends: number;
      if (action.operation === "resize") {
        const endAt = Date.parse(
          localInstant(day, minuteTime(minute ?? 600), preferences.zone),
        );
        starts = draggedStart;
        ends = endAt;
        if (ends <= starts) {
          setError("종료는 시작 이후여야 합니다.");
          return;
        }
      } else {
        const delta =
          minute !== undefined && !event.all_day
            ? Date.parse(
                localInstant(day, minuteTime(minute), preferences.zone),
              ) - draggedStart
            : Date.parse(atMidnight(day)) -
              Date.parse(
                atMidnight(
                  dayOf(
                    action.start,
                    event.all_day ? "Asia/Seoul" : preferences.zone,
                  ),
                ),
              );
        starts = draggedStart + delta;
        ends = draggedEnd + delta;
      }
      if (starts === draggedStart && ends === draggedEnd) return;
      if (starts === previousStart && ends === previousEnd) {
        setRepeatChange(null);
        return;
      }
      const change: DropChange = {
        event,
        operation: starts === previousStart ? "resize" : "move",
        occurrenceStart: action.occurrenceStart,
        previousStart,
        previousEnd,
        day,
        starts,
        ends,
      };
      if (event.recurrence) {
        setRepeatError("");
        if (pendingRepeat && repeatChange) {
          setRepeatChange({ ...repeatChange, change });
          setSelected(day);
        } else setRepeatChange({ change, scope: "single", mode: "new" });
      } else await saveDrop(change);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      dropInProgress.current = false;
    }
  }
  function continueRepeatChange(change: DropChange, scope: OccurrenceScope) {
    setDraft(null);
    setDirty(false);
    setExternalSelected(null);
    setSelectedEvent(null);
    setQuery("");
    setSelected(change.day);
    hideSmallPanel();
    setRepeatChange({ change, scope, mode: "pending" });
  }
  async function saveDrop(
    { event, day, starts, ends, occurrenceStart }: DropChange,
    scope?: OccurrenceScope,
  ) {
    const period = {
      starts_at: new Date(starts).toISOString(),
      ends_at: new Date(ends).toISOString(),
      expected_revision: event.revision,
    };
    if (scope) {
      await api(`/calendar/events/${event.id}/occurrence`, {
        ...period,
        scope,
        occurrence_start: occurrenceStart,
      });
    } else {
      await api(`/calendar/events/${event.id}/update`, {
        ...period,
        unit_id: event.unit_id,
        title: event.title,
        description: event.description,
        location: event.location,
        all_day: event.all_day,
      });
    }
    setDraft(null);
    setDirty(false);
    setSelected(day);
    setNotice("");
    setReload((r) => r + 1);
  }
  async function confirmRepeatChange(
    change: DropChange,
    scope: OccurrenceScope,
  ) {
    if (dropInProgress.current) return;
    dropInProgress.current = true;
    setRepeatSaving(true);
    try {
      await saveDrop(change, scope);
      setRepeatChange(null);
    } catch (error) {
      setRepeatError((error as Error).message);
    } finally {
      setRepeatSaving(false);
      dropInProgress.current = false;
    }
  }
  function showSearch() {
    setPanel(true);
    setPanelForced(true);
    requestAnimationFrame(() => searchInput.current?.focus());
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (reviewingRepeat) return;
      const target = e.target as HTMLElement;
      const input = target.closest(
        "input,textarea,select,[contenteditable=true]",
      );
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommands((v) => !v);
        return;
      }
      if (input || target.closest("dialog[open]") || e.altKey) return;
      if (
        (e.ctrlKey || e.metaKey) &&
        ["c", "v"].includes(e.key.toLowerCase())
      ) {
        if (e.key.toLowerCase() === "c" && selectedEvent) {
          e.preventDefault();
          copy(selectedEvent);
        } else if (e.key.toLowerCase() === "v" && clipboard) {
          e.preventDefault();
          paste(actionDay);
        }
        return;
      }
      if (e.ctrlKey || e.metaKey) return;
      switch (e.key.toLowerCase()) {
        case "c":
          e.preventDefault();
          add(actionDay);
          break;
        case "d":
          switchView("day");
          break;
        case "w":
          switchView("week");
          break;
        case "m":
          switchView("month");
          break;
        case "t":
          goToday();
          break;
        case ".":
          e.preventDefault();
          setJump(true);
          break;
        case "/":
          e.preventDefault();
          showSearch();
          break;
        case String.fromCharCode(92):
          e.preventDefault();
          setPanel((v) => !v);
          setPanelForced(true);
          break;
        case "[":
          navigate(-1);
          break;
        case "]":
          navigate(1);
          break;
        case "?":
          setPanel(true);
          setPanelForced(true);
          break;
        case "escape":
          setContext(null);
          if (draft) closeEditor();
          else setQuery("");
          break;
        case "delete":
        case "backspace":
          if (selectedEvent?.can_edit) {
            e.preventDefault();
            void api<CalendarEvent>(`/calendar/events/${selectedEvent.id}`)
              .then((event) => {
                if (leave()) {
                  setDraft({
                    day: dayOf(event.starts_at),
                    event,
                    removeRequested: true,
                  });
                  setPanel(true);
                  setPanelForced(true);
                }
              })
              .catch((error) => setError((error as Error).message));
          }
          break;
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const actions = [
    { label: "새 이벤트 만들기", key: "C", run: () => add(actionDay) },
    { label: "일 보기", key: "D", run: () => switchView("day") },
    { label: "주 보기", key: "W", run: () => switchView("week") },
    { label: "월 보기", key: "M", run: () => switchView("month") },
    { label: "오늘로 이동", key: "T", run: goToday },
    { label: "날짜로 이동", key: ".", run: () => setJump(true) },
    { label: "이벤트 검색", key: "/", run: showSearch },
    {
      label: "컨텍스트 패널 전환",
      key: String.fromCharCode(92),
      run: () => {
        setPanel((v) => !v);
        setPanelForced(true);
      },
    },
  ];
  return (
    <section
      ref={root}
      tabIndex={-1}
      className={`calendar-workspace notion-calendar ${expanded ? "is-expanded" : ""} ${sidebar ? "" : "sidebar-hidden"} ${panel ? "" : "context-hidden"}`}
      aria-labelledby="calendar-heading"
    >
      <header className="calendar-header">
        <div className="calendar-title">
          <span className="calendar-eyebrow">OUR SHARED DAYS</span>
          <h2 id="calendar-heading">우리의 일정</h2>
        </div>
        <div className="cal-header-tools">
          <button
            aria-label={
              sidebar ? "캘린더 사이드바 숨기기" : "캘린더 사이드바 표시"
            }
            onClick={() => setSidebar((v) => !v)}
          >
            ☷
          </button>
          <button
            aria-label={expanded ? "캘린더 축소" : "캘린더 확대"}
            aria-pressed={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            ⛶
          </button>
          <button
            ref={addButton}
            className="primary calendar-add"
            disabled={loading || !writable.length}
            onClick={() => add(actionDay)}
          >
            ＋ 일정 추가
          </button>
        </div>
      </header>
      <div className="calendar-layout">
        {sidebar && (
          <aside className="calendar-sidebar">
            <MiniCalendar
              anchor={view === "month" ? monthHeadingDay : anchor}
              selected={selected}
              today={today}
              onSelect={(day) => {
                focusDate(day);
                setSelected(day);
              }}
            />
            <div className="calendar-scope-heading">
              <h3>내 캘린더</h3>
              <button
                className="text-button"
                onClick={() => {
                  setChecked(null);
                  setHiddenExternal(new Set());
                }}
              >
                전체
              </button>
            </div>
            {orgs.map((org) => (
              <CalendarScopeRow
                key={org.id}
                org={org}
                visible={checked === null || checked.has(org.id)}
                color={organizationColors.get(org.id)}
                onToggle={() => toggleOrg(org.id)}
                onColorChange={(color) =>
                  setOrganizationColors((current) => {
                    const next = new Map(current);
                    if (color) next.set(org.id, color);
                    else next.delete(org.id);
                    return next;
                  })
                }
              />
            ))}
            {!loading && !units.length && (
              <p className="calendar-no-role">
                현재 유효한 업무 역할이 없습니다. 담당 책임자에게 역할 등록을
                요청해 주세요.
              </p>
            )}
            <div className="cal-sidebar-selected">
              <small>선택한 날짜</small>
              <strong>{longDay(selected)}</strong>
              <button
                className="cal-inline-action"
                disabled={!writable.length}
                onClick={() => add(selected)}
              >
                ＋ 선택일에 일정 추가
              </button>
            </div>
            <ExternalSources
              sources={external.sources}
              hidden={hiddenExternal}
              onToggle={(id) =>
                setHiddenExternal((current) => {
                  const next = new Set(current);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              loading={external.loading}
              error={external.error}
              canRefresh={external.can_refresh}
              onRefresh={() => void external.refresh()}
            />
            <small className="calendar-timezone">
              {preferences.zone === "UTC"
                ? "UTC · 세계 표준시"
                : "Asia/Seoul · 한국 시간"}
            </small>
          </aside>
        )}
        <div className="calendar-main">
          <div className="calendar-toolbar">
            <div className="calendar-month-title">
              <h3>{title}</h3>
              <div className="calendar-paging">
                <button aria-label="이전 기간" onClick={() => navigate(-1)}>
                  ‹
                </button>
                <button aria-label="다음 기간" onClick={() => navigate(1)}>
                  ›
                </button>
              </div>
              <button className="calendar-today" onClick={goToday}>
                오늘
              </button>
            </div>
            <div className="cal-toolbar-actions">
              <select
                aria-label="캘린더 보기"
                value={view}
                onChange={(e) => switchView(e.target.value as View)}
              >
                <option value="day">일</option>
                <option value="week">주</option>
                <option value="month">월</option>
              </select>
              <details className="cal-view-settings">
                <summary aria-label="캘린더 보기 설정">⚙</summary>
                <div>
                  <label>
                    일수
                    <select
                      aria-label="일수"
                      value={preferences.dayCount}
                      onChange={(e) =>
                        setPreferences((p) => ({
                          ...p,
                          dayCount: Number(e.target.value),
                        }))
                      }
                    >
                      {[3, 4, 5, 7].map((n) => (
                        <option key={n} value={n}>
                          {n}일
                        </option>
                      ))}
                    </select>
                  </label>
                  {(
                    [
                      ["weekends", "주말 표시"],
                      ["weekNumbers", "주 번호 표시"],
                      ["hour24", "24시간 표시"],
                      ["compact", "촘촘하게 보기"],
                    ] as const
                  ).map(([key, label]) => (
                    <label className="calendar-check" key={key}>
                      <input
                        type="checkbox"
                        checked={preferences[key]}
                        onChange={(e) =>
                          setPreferences((p) => ({
                            ...p,
                            [key]: e.target.checked,
                          }))
                        }
                      />
                      {label}
                    </label>
                  ))}
                  <label>
                    표시 시간대
                    <select
                      aria-label="표시 시간대"
                      value={preferences.zone}
                      onChange={(e) =>
                        setPreferences((p) => ({
                          ...p,
                          zone: e.target.value as "UTC" | "Asia/Seoul",
                        }))
                      }
                    >
                      <option value="Asia/Seoul">한국 GMT+9</option>
                      <option value="UTC">UTC GMT+0</option>
                    </select>
                  </label>
                  <button onClick={() => setJump(true)}>
                    원하는 날짜로 이동 ·
                  </button>
                </div>
              </details>
              <button
                className="cal-tool-button"
                aria-label="이벤트 검색"
                onClick={showSearch}
              >
                ⌕
              </button>
              <div className="cal-reminder-container">
                <button
                  className="cal-tool-button"
                  aria-label={`리마인더 ${reminders.length}개`}
                  onClick={() => setRemindersOpen((v) => !v)}
                >
                  ♧{reminders.length > 0 && <b>{reminders.length}</b>}
                </button>
                {remindersOpen && (
                  <section className="cal-reminder-popover">
                    <h3>리마인더</h3>
                    {reminderError && (
                      <p className="error" role="alert">
                        {reminderError}
                      </p>
                    )}
                    {!reminders.length && <p>현재 리마인더가 없습니다.</p>}
                    {reminders.map((r) => (
                      <div key={`${eventKey(r.event)}-${r.minutes}`}>
                        <button onClick={() => void open(r.event)}>
                          <strong>{r.event.title}</strong>
                          <small>
                            {r.minutes === 0
                              ? "시작할 때"
                              : `${r.minutes}분 전`}{" "}
                            ·{" "}
                            {displayTime(
                              r.event.starts_at,
                              preferences.hour24,
                              preferences.zone,
                            )}
                          </small>
                        </button>
                        <button
                          onClick={() => {
                            api(
                              `/calendar/events/${r.event.id}/reminder-read`,
                              {
                                occurrence_start: r.occurrence_start,
                                minutes: r.minutes,
                              },
                            )
                              .then(() =>
                                window.dispatchEvent(
                                  new Event(remindersChanged),
                                ),
                              )
                              .catch((e) =>
                                setReminderError((e as Error).message),
                              );
                          }}
                        >
                          확인
                        </button>
                      </div>
                    ))}
                    <small>포털이 열려 있을 때 확인할 수 있습니다.</small>
                  </section>
                )}
              </div>
              <button
                className="cal-tool-button"
                aria-label={
                  panel ? "컨텍스트 패널 숨기기" : "컨텍스트 패널 표시"
                }
                title="컨텍스트 패널 전환 · \"
                onClick={() => {
                  setPanel((v) => !v);
                  setPanelForced(true);
                }}
              >
                ◫
              </button>
            </div>
          </div>
          {error && (
            <div className="calendar-feedback error" role="alert">
              {error}
              <button
                className="text-button"
                onClick={() => setReload((r) => r + 1)}
              >
                다시 불러오기
              </button>
            </div>
          )}
          {notice && (
            <p className="calendar-feedback success" role="status">
              {notice}
            </p>
          )}
          {loading && (!hasLoaded || view !== "month") && (
            <p className="calendar-loading" role="status">
              일정을 불러오고 있습니다…
            </p>
          )}
          <div
            className="calendar-canvas"
            aria-busy={loading}
            onPointerDownCapture={(e) => {
              if (
                view === "month" ||
                (!draft && !externalSelected) ||
                e.button !== 0 ||
                (e.target as HTMLElement).closest(
                  ".calendar-event,.cal-timed-block",
                )
              )
                return;
              dismissPointer.current = true;
              e.preventDefault();
              e.stopPropagation();
              clearCanvasEditor();
            }}
            onPointerUpCapture={(e) => {
              if (dismissPointer.current) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            onPointerCancelCapture={() => {
              dismissPointer.current = false;
            }}
            onClickCapture={(e) => {
              if (view === "month") return;
              if (dismissPointer.current) {
                dismissPointer.current = false;
                e.preventDefault();
                e.stopPropagation();
              } else if (
                e.detail === 0 &&
                (draft || externalSelected) &&
                !(e.target as HTMLElement).closest(
                  ".calendar-event,.cal-timed-block",
                )
              ) {
                e.preventDefault();
                e.stopPropagation();
                clearCanvasEditor();
              }
            }}
          >
            {view === "month" ? (
              <MonthGrid
                days={days}
                windowStart={monthWindow.start}
                position={monthWindow.position}
                anchor={monthHeadingDay}
                today={today}
                selected={selected}
                events={visible}
                preferences={preferences}
                canCreate={Boolean(writable.length)}
                onAdd={add}
                onOpen={(event) => void open(event)}
                onContext={menu}
                onDrop={(e, day, minute) => void drop(e, day, minute)}
                onScrollWeek={scrollMonth}
                onBlankClick={
                  draft || externalSelected ? clearCanvasEditor : undefined
                }
              />
            ) : (
              <TimeGrid
                days={days}
                today={today}
                events={visible}
                preferences={preferences}
                onAdd={add}
                onOpen={(event) => void open(event)}
                onContext={menu}
                onDrop={(e, day, minute) => void drop(e, day, minute)}
                label={view === "day" ? "일간 일정" : "주간 일정"}
              />
            )}
          </div>
          <section
            className="calendar-mobile-agenda"
            aria-label="이 기간의 일정"
          >
            <h3>
              이 기간의 일정 <span>{agendaEvents.length}</span>
            </h3>
            {agendaEvents.length ? (
              <ul>
                {agendaEvents.map((event) => (
                  <li key={eventKey(event)}>
                    <button
                      onClick={() => void open(event)}
                      aria-label={`${event.title} ${event.pendingMove ? "저장 전 변경 확인" : "상세 보기"}`}
                      data-pending-move={event.pendingMove}
                    >
                      <i
                        className={`calendar-dot calendar-tone-${tone(event.displayCalendar?.org_id || event.org_id)}`}
                        style={
                          event.displayColor
                            ? {
                                background: calendarColorHex(
                                  event.displayCalendar?.org_id || event.org_id,
                                  event.displayColor,
                                ),
                              }
                            : undefined
                        }
                      />
                      <span>
                        <strong>
                          {event.pendingMove && (
                            <i className="cal-pending-dot" aria-hidden="true" />
                          )}
                          {event.title}
                        </strong>
                        <small>
                          {longDay(
                            dayOf(
                              event.starts_at,
                              event.all_day ? "Asia/Seoul" : preferences.zone,
                            ),
                          )}{" "}
                          ·{" "}
                          {event.all_day
                            ? "종일"
                            : displayTime(
                                event.starts_at,
                                preferences.hour24,
                                preferences.zone,
                              )}{" "}
                          · {event.displayCalendar?.org_name || event.org_name}
                        </small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>등록된 일정이 없습니다.</p>
            )}
          </section>
          <div className="calendar-bottom">
            <span>
              {view === "month" && "세로 스크롤·빈 곳 드래그로 주 이동 · "}
              날짜 우클릭으로 이벤트 만들기 · 드래그로 일정 이동
            </span>
            <small>일정 {agendaEvents.length}개</small>
          </div>
        </div>
        {panel && (
          <aside
            className={`calendar-context ${draft ? "has-editor" : "is-idle"} ${panelForced ? "is-forced" : ""}`}
            aria-label="컨텍스트 패널"
          >
            <div className="cal-context-search">
              <input
                ref={searchInput}
                aria-label="이벤트 검색어"
                placeholder="이벤트 검색"
                maxLength={150}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                aria-label="컨텍스트 패널 닫기"
                onClick={() => {
                  setPanel(false);
                  setPanelForced(false);
                }}
              >
                ✕
              </button>
            </div>
            {query.trim() ? (
              <section className="cal-search-results">
                <h3>검색 결과</h3>
                {searching && <p role="status">검색 중…</p>}
                {searchError && (
                  <p className="error" role="alert">
                    {searchError}
                  </p>
                )}
                {!searching && !searchError && !searchResults.length && (
                  <p>검색 결과가 없습니다.</p>
                )}
                {searchResults
                  .filter(
                    (event) =>
                      checked === null ||
                      eventCalendars(event).some((target) =>
                        checked.has(target.org_id),
                      ),
                  )
                  .map((event) => (
                    <button
                      key={event.id}
                      onClick={() => {
                        if (!leave()) return;
                        focusDate(dayOf(event.starts_at));
                        setSelected(dayOf(event.starts_at));
                        setQuery("");
                        void open(event);
                      }}
                    >
                      <strong>{event.title}</strong>
                      <small>
                        {dayOf(
                          event.starts_at,
                          event.all_day ? "Asia/Seoul" : preferences.zone,
                        )}{" "}
                        · {event.org_name}
                      </small>
                    </button>
                  ))}
                {moreResults && (
                  <small>최대 50개 표시 · 검색어를 좁혀 주세요.</small>
                )}
              </section>
            ) : externalSelected ? (
              <ExternalEventDetail
                event={externalSelected}
                onClose={() => setExternalSelected(null)}
              />
            ) : draft ? (
              <EventDialog
                draft={draft}
                units={units}
                defaultUnit={defaultUnit}
                organizationColors={organizationColors}
                defaultZone={preferences.zone}
                onClose={closeEditor}
                onSaved={saved}
                onRemoved={() => {
                  setDraft(null);
                  setDirty(false);
                  hideSmallPanel();
                  setSelectedEvent(null);
                  setNotice("");
                  setReload((r) => r + 1);
                }}
                onDirty={setDirty}
                onBusy={setEditorBusy}
                onCopy={copy}
              />
            ) : (
              <ShortcutHelp />
            )}
          </aside>
        )}
      </div>
      {context && (
        <div
          role="menu"
          className="cal-context-menu"
          style={{ left: context.x, top: context.y }}
        >
          {context.event ? (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  void open(context.event!);
                  setContext(null);
                }}
              >
                이벤트 열기
              </button>
              <button role="menuitem" onClick={() => copy(context.event!)}>
                이벤트 복사 <kbd>Ctrl C</kbd>
              </button>
              {context.event.can_edit && (
                <button
                  role="menuitem"
                  onClick={() => {
                    const event = context.event!;
                    setContext(null);
                    if (leave()) {
                      void api<CalendarEvent>(`/calendar/events/${event.id}`)
                        .then((fresh) => {
                          setDraft({
                            day: context.day,
                            event: fresh,
                            removeRequested: true,
                          });
                          setDirty(false);
                          setPanel(true);
                          setPanelForced(true);
                        })
                        .catch((e) => setError((e as Error).message));
                    }
                  }}
                >
                  이벤트 삭제
                </button>
              )}
            </>
          ) : (
            <button
              role="menuitem"
              disabled={!writable.length}
              onClick={() => {
                add(context.day);
                setContext(null);
              }}
            >
              이벤트 만들기 <kbd>C</kbd>
            </button>
          )}
          <button
            role="menuitem"
            disabled={!clipboard || !writable.length}
            onClick={() => paste(context.day)}
          >
            이벤트 붙여넣기 <kbd>Ctrl V</kbd>
          </button>
        </div>
      )}
      <CommandPalette
        open={commands}
        onClose={() => setCommands(false)}
        actions={actions}
      />
      {reviewingRepeat && (
        <RepeatChangeDialog
          change={reviewingRepeat.change}
          initialScope={reviewingRepeat.scope}
          preferences={preferences}
          saving={repeatSaving}
          error={repeatError}
          onCancel={() => setRepeatChange(null)}
          onContinue={(scope) =>
            continueRepeatChange(reviewingRepeat.change, scope)
          }
          onConfirm={(scope) =>
            void confirmRepeatChange(reviewingRepeat.change, scope)
          }
        />
      )}
      <dialog
        ref={jumpDialog}
        className="cal-jump-dialog"
        aria-labelledby="cal-jump-title"
        onCancel={(e) => {
          e.preventDefault();
          setJump(false);
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            focusDate(jumpDay);
            setSelected(jumpDay);
            setJump(false);
          }}
        >
          <h2 id="cal-jump-title">원하는 날짜로 이동</h2>
          <label>
            이동할 날짜
            <input
              type="date"
              autoFocus
              required
              value={jumpDay}
              onChange={(e) => setJumpDay(e.target.value)}
            />
          </label>
          <div>
            <button type="button" onClick={() => setJump(false)}>
              취소
            </button>
            <button className="primary">이동</button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
