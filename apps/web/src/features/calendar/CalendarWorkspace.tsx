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
  type CalendarUnit,
  type CalendarEvent,
  type Draft,
  type CalendarPreferences,
  type View,
  type Reminder,
} from "./api";
import EventDialog from "./EventDialog";
import {
  useExternalCalendars,
  ExternalSources,
  ExternalEventDetail,
} from "./ExternalCalendars";
import MonthGrid from "./MonthGrid";
import TimeGrid from "./TimeGrid";
import { MiniCalendar, CommandPalette, ShortcutHelp } from "./CalendarTools";
import type { CalendarDrag } from "./EventChip";
import {
  atMidnight,
  dayOf,
  displayTime,
  eventKey,
  localInstant,
  longDay,
  moveMonth,
  shiftDay,
  tone,
  visibleDayRange,
} from "./dates";
import WorkspaceIcon from "../workspace/WorkspaceIcon";
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

type Context = { x: number; y: number; day: string; event?: CalendarEvent };
export default function CalendarWorkspace({ time }: { time: string }) {
  const [preferences, setPreferences] =
    useState<CalendarPreferences>(loadPreferences);
  const today = dayOf(time, preferences.zone);
  const [anchor, setAnchor] = useState(today),
    [selected, setSelected] = useState(today),
    [view, setView] = useState<View>("month");
  const [units, setUnits] = useState<CalendarUnit[]>([]),
    [events, setEvents] = useState<CalendarEvent[]>([]),
    [checked, setChecked] = useState<Set<string> | null>(null);
  const [loading, setLoading] = useState(true),
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
      visibleDayRange(anchor, view, preferences.dayCount, preferences.weekends),
    [anchor, view, preferences.dayCount, preferences.weekends],
  );
  const start = days[0],
    end = shiftDay(days[days.length - 1], 1);
  const external = useExternalCalendars(
    new URLSearchParams({
      start: atMidnight(start, preferences.zone),
      end: atMidnight(end, preferences.zone),
    }).toString(),
    reload,
  );
  useEffect(() => {
    if (!external.loading && !external.error)
      setExternalSelected((current) =>
        current
          ? external.events.find((event) => event.id === current.id) || null
          : null,
      );
  }, [external.events, external.loading, external.error]);
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
    if (!expanded) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = old;
    };
  }, [expanded]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
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
    let alive = true;
    setLoading(true);
    setError("");
    setEvents([]);
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
        }
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
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
    return () => {
      alive = false;
      clearInterval(id);
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
  const visible = [
    ...events.filter((e) => checked === null || checked.has(e.org_id)),
    ...external.events.filter((e) => !hiddenExternal.has(e.external_source!)),
  ].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const writable = units.filter((u) => u.can_create);
  const defaultUnit =
    writable.find((u) => checked === null || checked.has(u.org_id))?.id ||
    writable[0]?.id ||
    "";
  const title =
    view === "day"
      ? `${Number(anchor.slice(0, 4))}년 ${Number(anchor.slice(5, 7))}월 ${Number(anchor.slice(8))}일`
      : `${Number(anchor.slice(0, 4))}년 ${Number(anchor.slice(5, 7))}월`;
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
  async function open(event: CalendarEvent) {
    if (!leave()) return;
    if (event.external_source) {
      setDraft(null);
      setDirty(false);
      setExternalSelected(event);
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
      const fresh = await api<CalendarEvent>(`/calendar/events/${event.id}`);
      setQuery("");
      setRemindersOpen(false);
      setSelectedEvent(event);
      setDraft({
        day: dayOf(
          fresh.starts_at,
          fresh.all_day ? "Asia/Seoul" : fresh.time_zone,
        ),
        event: fresh,
        occurrenceDay: dayOf(
          event.starts_at,
          event.all_day ? "Asia/Seoul" : preferences.zone,
        ),
      });
      setDirty(false);
      setPanel(true);
      setPanelForced(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function navigate(direction: number) {
    const next =
      view === "month"
        ? moveMonth(anchor, direction)
        : shiftDay(
            anchor,
            direction * (view === "day" ? 1 : preferences.dayCount),
          );
    setAnchor(next);
    setSelected(next);
    setNotice("");
  }
  function goToday() {
    setAnchor(today);
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
    setAnchor(selectedDay);
    setSelected(selectedDay);
    if (checked !== null) setChecked(new Set([...checked, event.org_id]));
    hideSmallPanel();
    setNotice("일정을 저장했습니다.");
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
    const same = writable.some((u) => u.id === clipboard.unit_id);
    setQuery("");
    setDraft({
      day,
      copy: {
        ...clipboard,
        unit_id: same ? clipboard.unit_id : defaultUnit,
        participant_ids: same ? clipboard.participant_ids : [],
      },
    });
    setSelected(day);
    setDirty(false);
    setPanel(true);
    setPanelForced(true);
    setContext(null);
  }
  function menu(e: MouseEvent, day: string, event?: CalendarEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (event?.external_source) {
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
    if (!raw || !leave()) return;
    try {
      const action = JSON.parse(raw) as CalendarDrag;
      const event = await api<CalendarEvent>(`/calendar/events/${action.id}`);
      if (!event.can_edit) return;
      if (
        event.recurrence &&
        !window.confirm("반복 일정의 전체 시리즈에 변경을 적용할까요?")
      )
        return;
      const occurrence = Date.parse(action.start);
      let starts: number, ends: number;
      if (action.operation === "resize") {
        const endAt = Date.parse(
          localInstant(
            day,
            `${Math.floor((minute ?? 600) / 60)
              .toString()
              .padStart(
                2,
                "0",
              )}:${((minute ?? 600) % 60).toString().padStart(2, "0")}`,
            preferences.zone,
          ),
        );
        starts = Date.parse(event.starts_at);
        ends = starts + (endAt - occurrence);
        if (ends <= starts) {
          setError("종료는 시작 이후여야 합니다.");
          return;
        }
      } else {
        const delta =
          minute !== undefined && !event.all_day
            ? Date.parse(
                localInstant(
                  day,
                  `${Math.floor(minute / 60)
                    .toString()
                    .padStart(
                      2,
                      "0",
                    )}:${(minute % 60).toString().padStart(2, "0")}`,
                  preferences.zone,
                ),
              ) - occurrence
            : Date.parse(atMidnight(day)) -
              Date.parse(
                atMidnight(
                  dayOf(
                    action.start,
                    event.all_day ? "Asia/Seoul" : preferences.zone,
                  ),
                ),
              );
        starts = Date.parse(event.starts_at) + delta;
        ends = Date.parse(event.ends_at) + delta;
      }
      await api(`/calendar/events/${event.id}/update`, {
        unit_id: event.unit_id,
        title: event.title,
        description: event.description,
        location: event.location,
        all_day: event.all_day,
        starts_at: new Date(starts).toISOString(),
        ends_at: new Date(ends).toISOString(),
        expected_revision: event.revision,
      });
      setDraft(null);
      setDirty(false);
      setSelected(day);
      setNotice(
        action.operation === "resize"
          ? "일정 시간을 변경했습니다."
          : "일정을 이동했습니다.",
      );
      setReload((r) => r + 1);
    } catch (error) {
      setError((error as Error).message);
    }
  }
  function showSearch() {
    setPanel(true);
    setPanelForced(true);
    requestAnimationFrame(() => searchInput.current?.focus());
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
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
          paste(selected);
        }
        return;
      }
      if (e.ctrlKey || e.metaKey) return;
      switch (e.key.toLowerCase()) {
        case "c":
          e.preventDefault();
          add(selected);
          break;
        case "d":
          setView("day");
          break;
        case "w":
          setView("week");
          break;
        case "m":
          setView("month");
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
    { label: "새 이벤트 만들기", key: "C", run: () => add(selected) },
    { label: "일 보기", key: "D", run: () => setView("day") },
    { label: "주 보기", key: "W", run: () => setView("week") },
    { label: "월 보기", key: "M", run: () => setView("month") },
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
            onClick={() => add(selected)}
          >
            ＋ 일정 추가
          </button>
        </div>
      </header>
      <div className="calendar-layout">
        {sidebar && (
          <aside className="calendar-sidebar">
            <MiniCalendar
              anchor={anchor}
              selected={selected}
              today={today}
              onSelect={(day) => {
                setAnchor(day);
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
              <label className="calendar-scope" key={org.id}>
                <input
                  type="checkbox"
                  checked={checked === null || checked.has(org.id)}
                  onChange={() => toggleOrg(org.id)}
                />
                <i className={`calendar-dot calendar-tone-${tone(org.id)}`} />
                <span>{org.name}</span>
              </label>
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
                onChange={(e) => setView(e.target.value as View)}
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
                              .then(() => setReload((n) => n + 1))
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
          {loading && (
            <p className="calendar-loading" role="status">
              일정을 불러오고 있습니다…
            </p>
          )}
          <div
            className="calendar-canvas"
            aria-busy={loading}
            onPointerDownCapture={(e) => {
              if (
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
                anchor={anchor}
                today={today}
                selected={selected}
                events={visible}
                preferences={preferences}
                canCreate={Boolean(writable.length)}
                onAdd={add}
                onOpen={(event) => void open(event)}
                onContext={menu}
                onDrop={(e, day, minute) => void drop(e, day, minute)}
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
              이 기간의 일정 <span>{visible.length}</span>
            </h3>
            {visible.length ? (
              <ul>
                {visible.map((event) => (
                  <li key={eventKey(event)}>
                    <button
                      onClick={() => void open(event)}
                      aria-label={`${event.title} 상세 보기`}
                    >
                      <i
                        className={`calendar-dot calendar-tone-${tone(event.org_id)}`}
                      />
                      <span>
                        <strong>{event.title}</strong>
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
                          · {event.org_name}
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
            <span>날짜 우클릭으로 이벤트 만들기 · 드래그로 일정 이동</span>
            <small>일정 {visible.length}개</small>
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
                  .filter((e) => checked === null || checked.has(e.org_id))
                  .map((event) => (
                    <button
                      key={event.id}
                      onClick={() => {
                        if (!leave()) return;
                        setAnchor(dayOf(event.starts_at));
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
                defaultZone={preferences.zone}
                onClose={closeEditor}
                onSaved={saved}
                onRemoved={() => {
                  setDraft(null);
                  setDirty(false);
                  hideSmallPanel();
                  setSelectedEvent(null);
                  setNotice("일정을 삭제했습니다.");
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
            setAnchor(jumpDay);
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
