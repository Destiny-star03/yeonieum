import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  api,
  eventCalendars,
  type CalendarUnit,
  type CalendarEvent,
  type Draft,
  type EventLink,
  type PersonOption,
  type DocumentOption,
} from "./api";
import {
  atMidnight,
  dayOf,
  localFields,
  localInstant,
  shiftDay,
} from "./dates";
import {
  DatePicker,
  PickerPopover,
  TimePicker,
  durationLabel,
} from "./DateTimePickers";
import ColorPicker from "./ColorPicker";
import CalendarIcon, { type CalendarIconName } from "./CalendarIcon";
import type { CalendarColor } from "./calendarColors";
import RepeatPicker from "./RepeatPicker";

type Props = {
  draft: Draft;
  units: CalendarUnit[];
  defaultUnit: string;
  organizationColors: ReadonlyMap<string, CalendarColor>;
  defaultZone: "Asia/Seoul" | "UTC";
  onClose: () => void;
  onSaved: (event: CalendarEvent) => void;
  onRemoved: () => void;
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
  onCopy: (event: CalendarEvent) => void;
};
function initial(
  draft: Draft,
  defaultUnit: string,
  defaultZone: "Asia/Seoul" | "UTC",
) {
  const event = draft.event || draft.copy,
    zone = event?.time_zone || defaultZone;
  const start = event
    ? localFields(event.starts_at, event.all_day ? "Asia/Seoul" : zone)
    : { day: draft.day, time: draft.startTime || "09:00" };
  const end = event
    ? localFields(
        event.all_day
          ? new Date(Date.parse(event.ends_at) - 1).toISOString()
          : event.ends_at,
        event.all_day ? "Asia/Seoul" : zone,
      )
    : draft.endTime
      ? { day: draft.endDay || draft.day, time: draft.endTime }
      : localFields(
          new Date(
            Date.parse(localInstant(start.day, start.time, zone)) + 30 * 60000,
          ).toISOString(),
          zone,
        );
  if (draft.copy) {
    const days =
      Date.parse(atMidnight(draft.day)) - Date.parse(atMidnight(start.day));
    end.day = shiftDay(end.day, Math.round(days / 86400000));
    start.day = draft.day;
  }
  return {
    title: event ? (draft.copy ? `${event.title} 사본` : event.title) : "",
    unitIds: event
      ? eventCalendars(event).map((target) => target.unit_id)
      : [defaultUnit].filter(Boolean),
    allDay: event?.all_day ?? draft.allDay ?? false,
    startDay: start.day,
    endDay: end.day,
    startTime: start.time,
    endTime: event?.all_day ? "09:30" : end.time,
    location: event?.location || "",
    description: event?.description || "",
    zone,
    repeat: event?.recurrence || null,
    participantIds: event?.participant_ids || [],
    links: event?.links || ([] as EventLink[]),
    attachmentIds: event?.attachment_ids || [],
    reminders: event?.reminder_minutes || [],
    availability: event?.availability || "busy",
    visibility: event?.visibility || "details",
    color: event?.color || "default",
  };
}
const validTime = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
function periodDuration(values: ReturnType<typeof initial>) {
  if (!validTime.test(values.startTime) || !validTime.test(values.endTime))
    return 0;
  const duration =
    Date.parse(`${values.endDay}T${values.endTime}:00Z`) -
    Date.parse(`${values.startDay}T${values.startTime}:00Z`);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}
function EditorPopoverRow({
  label,
  icon,
  detail,
  open,
  onToggle,
  onClose,
  children,
}: {
  label: string;
  icon: CalendarIconName;
  detail?: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (open)
      content.current
        ?.querySelector<HTMLElement>(
          "button:enabled, input:enabled, select:enabled, a[href]",
        )
        ?.focus({ preventScroll: true });
  }, [open]);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="cal-editor-inline-row"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? id : undefined}
        onClick={onToggle}
      >
        <CalendarIcon name={icon} />
        <span>{label}</span>
        {detail && <span className="cal-editor-row-value">{detail}</span>}
      </button>
      {open && (
        <PickerPopover
          anchor={anchor}
          id={id}
          label={label}
          className="cal-editor-popup"
          onClose={onClose}
        >
          <div ref={content}>{children}</div>
        </PickerPopover>
      )}
    </>
  );
}
type EditorPopup = "participants" | "links" | "reminders";

function validLink(value: string) {
  if (!value.trim()) return true;
  if (!/^https?:\/\//i.test(value.trim())) return false;
  try {
    const url = new URL(value.trim());
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
export default function EventDialog({
  draft,
  units,
  defaultUnit,
  organizationColors,
  defaultZone,
  onClose,
  onSaved,
  onRemoved,
  onDirty,
  onBusy,
  onCopy,
}: Props) {
  const [values, setValues] = useState(() =>
    initial(draft, defaultUnit, defaultZone),
  );
  const lastDuration = useRef(periodDuration(values) || 30 * 60000);
  const [timeSettingsOpen, setTimeSettingsOpen] = useState(false);
  const timeSettingsId = useId();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(Boolean(draft.removeRequested));
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [documents, setDocuments] = useState<DocumentOption[]>([]);
  const [peopleSearch, setPeopleSearch] = useState("");
  const [docSearch, setDocSearch] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const peopleRef = useRef<HTMLInputElement>(null);
  const peopleChoices = useRef<HTMLDivElement>(null);
  const peoplePopupId = useId();
  const linkInputId = useId();
  const [popup, setPopup] = useState<EditorPopup | null>(null);
  const editable = !draft.event || draft.event.can_edit;
  useEffect(() => {
    if (!values.allDay) {
      const duration = periodDuration(values);
      if (duration) lastDuration.current = duration;
    }
  }, [
    values.startDay,
    values.startTime,
    values.endDay,
    values.endTime,
    values.allDay,
  ]);
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);
  useEffect(() => {
    setValues(initial(draft, defaultUnit, defaultZone));
    setTimeSettingsOpen(false);
    setConfirming(Boolean(draft.removeRequested));
    setError("");
    setPeopleSearch("");
    setDocSearch("");
    setPopup(null);
    onDirty(false);
    requestAnimationFrame(() =>
      titleRef.current?.focus({ preventScroll: true }),
    );
  }, [draft]);
  useEffect(() => {
    let alive = true;
    setPeople([]);
    setDocuments([]);
    if (values.unitIds.length && editable)
      api<{ participants: PersonOption[]; documents: DocumentOption[] }>(
        `/calendar/editor-options?${new URLSearchParams(values.unitIds.map((id) => ["unit_id", id]))}`,
      )
        .then((result) => {
          if (alive) {
            setPeople(result.participants);
            setDocuments(result.documents);
          }
        })
        .catch((e) => {
          if (alive) setError((e as Error).message);
        });
    return () => {
      alive = false;
    };
  }, [values.unitIds, editable]);
  function change<K extends keyof typeof values>(
    key: K,
    value: (typeof values)[K],
  ) {
    setValues((old) => ({ ...old, [key]: value }));
    onDirty(true);
  }
  function changeStartTime(time: string) {
    // Keep the last valid length while a time is only partly typed.
    const end = validTime.test(time)
      ? localFields(
          new Date(
            Date.parse(localInstant(values.startDay, time, values.zone)) +
              (periodDuration(values) || lastDuration.current),
          ).toISOString(),
          values.zone,
        )
      : null;
    setValues((old) => ({
      ...old,
      startTime: time,
      ...(end ? { endDay: end.day, endTime: end.time } : {}),
    }));
    onDirty(true);
  }
  function pick(key: "participantIds" | "attachmentIds", id: string) {
    change(
      key,
      values[key].includes(id)
        ? values[key].filter((x) => x !== id)
        : [...values[key], id],
    );
  }
  function togglePopup(target: EditorPopup) {
    setPopup((current) => (current === target ? null : target));
  }
  function closePopup(target: EditorPopup) {
    setPopup((current) => (current === target ? null : current));
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editable || !values.unitIds.length) return;
    setError("");
    let starts: string, ends: string;
    try {
      starts = values.allDay
        ? atMidnight(values.startDay)
        : localInstant(values.startDay, values.startTime, values.zone);
      ends = values.allDay
        ? atMidnight(shiftDay(values.endDay, 1))
        : localInstant(values.endDay, values.endTime, values.zone);
    } catch {
      setError("날짜와 시간을 확인해 주세요.");
      return;
    }
    if (starts >= ends) {
      setError("종료는 시작 이후여야 합니다. 날짜와 시간을 확인해 주세요.");
      return;
    }
    const invalidLink = values.links.findIndex((link) => !validLink(link.url));
    if (invalidLink >= 0) {
      setError("링크 주소에 http 또는 https 주소를 입력해 주세요.");
      setPopup("links");
      requestAnimationFrame(() =>
        document.getElementById(`${linkInputId}-${invalidLink}`)?.focus(),
      );
      return;
    }
    setBusy(true);
    try {
      const body = {
        unit_id: values.unitIds[0],
        title: values.title,
        starts_at: starts,
        ends_at: ends,
        all_day: values.allDay,
        location: values.location,
        description: values.description,
        time_zone: values.allDay ? "Asia/Seoul" : values.zone,
        recurrence: values.repeat,
        participant_ids: values.participantIds,
        links: values.links
          .filter((l) => l.url.trim())
          .map((l) => ({ title: l.title.trim() || "링크", url: l.url.trim() })),
        attachment_ids: values.attachmentIds,
        reminder_minutes: values.reminders,
        availability: values.availability,
        visibility: values.visibility,
        color: values.color,
      };
      const event = await api<CalendarEvent>(
        draft.event
          ? `/calendar/events/${draft.event.id}/update`
          : "/calendar/events",
        draft.event
          ? { ...body, expected_revision: draft.event.revision }
          : { ...body, additional_unit_ids: values.unitIds.slice(1) },
      );
      onDirty(false);
      onSaved(event);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!draft.event || !editable) return;
    setBusy(true);
    setError("");
    try {
      await api(`/calendar/events/${draft.event.id}/remove`, {
        expected_revision: draft.event.revision,
        confirmed: true,
      });
      onDirty(false);
      onRemoved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const eventPeople = [
    ...people,
    ...(draft.event?.participants || []).filter(
      (p) => !people.some((x) => x.id === p.id),
    ),
  ];
  const matchingPeople = eventPeople.filter((person) =>
    person.name.includes(peopleSearch),
  );
  const selectedUnits = values.unitIds.flatMap((id) =>
    units.filter((unit) => unit.id === id),
  );
  const selectedUnit = selectedUnits[0];
  const selectedOrgIds = selectedUnits.map((unit) => unit.org_id);
  const organizationUnits = new Map<string, CalendarUnit>();
  for (const unit of units) {
    if (
      unit.can_create &&
      (!organizationUnits.has(unit.org_id) || unit.id === unit.org_id)
    ) {
      organizationUnits.set(unit.org_id, unit);
    }
  }
  const organizationOptions = [...organizationUnits.values()];
  function changeUnits(unitIds: string[]) {
    setValues((current) => ({
      ...current,
      unitIds,
      participantIds: current.unitIds.every((id) => unitIds.includes(id))
        ? current.participantIds
        : [],
    }));
    setPeopleSearch("");
    onDirty(true);
  }
  function toggleUnit(id: string) {
    const option = units.find((unit) => unit.id === id);
    const alreadySelected = selectedUnits.find(
      (unit) => unit.org_id === option?.org_id,
    );
    changeUnits(
      alreadySelected
        ? values.unitIds.filter((unitId) => unitId !== alreadySelected.id)
        : [...values.unitIds, id],
    );
  }
  function toggleAllUnits() {
    const allSelected = organizationOptions.every((unit) =>
      selectedOrgIds.includes(unit.org_id),
    );
    changeUnits(
      allSelected
        ? []
        : organizationOptions.map(
            (unit) =>
              selectedUnits.find((selected) => selected.org_id === unit.org_id)
                ?.id || unit.id,
          ),
    );
  }
  const referenceCount = values.links.length + values.attachmentIds.length;
  return (
    <section
      className="notion-event-editor"
      role="dialog"
      aria-modal="false"
      aria-labelledby="calendar-dialog-title"
    >
      <form onSubmit={save}>
        <div className="cal-editor-heading">
          <h2 id="calendar-dialog-title">
            {draft.event ? "이벤트" : "이벤트 만들기"}
          </h2>
          <div>
            {draft.event && (
              <details className="cal-event-menu">
                <summary aria-label="일정 더보기">···</summary>
                <div>
                  <button type="button" onClick={() => onCopy(draft.event!)}>
                    일정 복사
                  </button>
                  {editable && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.currentTarget
                          .closest("details")
                          ?.removeAttribute("open");
                        setConfirming(true);
                      }}
                    >
                      일정 삭제
                    </button>
                  )}
                </div>
              </details>
            )}
            <button
              type="button"
              className="text-button"
              aria-label="일정 창 닫기"
              disabled={busy}
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </div>
        <input
          ref={titleRef}
          className="cal-editor-title"
          aria-label="일정 제목"
          name="title"
          required
          maxLength={120}
          placeholder="제목 추가"
          value={values.title}
          disabled={busy || !editable}
          onChange={(e) => change("title", e.target.value)}
        />
        {draft.event?.recurrence && editable && (
          <p className="cal-editor-note">
            변경 저장은 전체 반복 일정에 적용됩니다.
          </p>
        )}
        {draft.event?.is_masked && (
          <p className="cal-editor-note">
            세부 정보는 작성자·참여자·관리권자에게만 표시됩니다.
          </p>
        )}
        <fieldset className="cal-editor-period" aria-label="날짜와 시간">
          <div className="cal-period">
            <div className="cal-period-times" hidden={values.allDay}>
              <span className="cal-period-clock" aria-hidden="true">
                <CalendarIcon name="clock" />
              </span>
              <TimePicker
                label="시작 시간"
                value={values.startTime}
                disabled={busy || !editable || values.allDay}
                onChange={changeStartTime}
              />
              <span className="cal-period-arrow" aria-hidden="true">
                →
              </span>
              <TimePicker
                label="종료 시간"
                value={values.endTime}
                disabled={busy || !editable || values.allDay}
                onChange={(time) => change("endTime", time)}
                duration={(time) =>
                  (Date.parse(`${values.endDay}T${time}:00Z`) -
                    Date.parse(`${values.startDay}T${values.startTime}:00Z`)) /
                  60000
                }
              />
              <span
                className="cal-period-duration"
                aria-label="일정 길이"
                aria-live="polite"
              >
                {!values.allDay &&
                  durationLabel(
                    (Date.parse(`${values.endDay}T${values.endTime}:00Z`) -
                      Date.parse(
                        `${values.startDay}T${values.startTime}:00Z`,
                      )) /
                      60000,
                  )}
              </span>
            </div>
            <div className="cal-period-dates">
              <DatePicker
                label="시작일"
                value={values.startDay}
                disabled={busy || !editable}
                onChange={(day) => {
                  change("startDay", day);
                  if (day > values.endDay) change("endDay", day);
                }}
              />
              <span className="cal-period-arrow" aria-hidden="true">
                →
              </span>
              <DatePicker
                label="종료일"
                value={values.endDay}
                min={values.startDay}
                disabled={busy || !editable}
                onChange={(day) => change("endDay", day)}
              />
            </div>
          </div>
          <div
            className={`cal-time-settings ${timeSettingsOpen ? "is-expanded" : ""}`}
          >
            <button
              type="button"
              className="cal-time-settings-toggle"
              aria-label="종일·시간대·반복 설정"
              aria-expanded={timeSettingsOpen}
              aria-controls={timeSettingsId}
              title={timeSettingsOpen ? "시간 설정 접기" : "시간 설정 펼치기"}
              disabled={busy}
              onClick={() => setTimeSettingsOpen((open) => !open)}
            >
              {timeSettingsOpen ? (
                <span aria-hidden="true">⌃</span>
              ) : (
                <>
                  <span className={values.allDay ? "is-set" : ""}>종일</span>
                  <span className={values.zone !== defaultZone ? "is-set" : ""}>
                    시간대
                  </span>
                  <span className={values.repeat ? "is-set" : ""}>반복</span>
                </>
              )}
            </button>
            <div
              id={timeSettingsId}
              className="cal-time-settings-content"
              hidden={!timeSettingsOpen}
            >
              <label className="calendar-check cal-all-day-toggle">
                <input
                  type="checkbox"
                  checked={values.allDay}
                  disabled={busy || !editable}
                  onChange={(e) => change("allDay", e.target.checked)}
                />
                종일
              </label>
              {!values.allDay && (
                <label className="cal-period-zone">
                  <CalendarIcon name="globe" />
                  <select
                    aria-label="시간대"
                    value={values.zone}
                    disabled={busy || !editable}
                    onChange={(e) =>
                      change("zone", e.target.value as "Asia/Seoul" | "UTC")
                    }
                  >
                    <option value="Asia/Seoul">한국 · GMT+9</option>
                    <option value="UTC">UTC · GMT+0</option>
                  </select>
                </label>
              )}
              <RepeatPicker
                value={values.repeat}
                day={values.startDay}
                disabled={busy || !editable}
                emptyLabel="반복"
                onChange={(repeat) => change("repeat", repeat)}
              />
            </div>
          </div>
        </fieldset>
        <div className="cal-editor-rows">
          {(editable || values.participantIds.length > 0) && (
            <>
              <div className="cal-editor-icon-row">
                <CalendarIcon name="person" />
                <input
                  ref={peopleRef}
                  className="cal-editor-inline-row"
                  aria-label={editable ? "참여자 검색" : "참여자"}
                  aria-haspopup={editable ? "dialog" : undefined}
                  aria-expanded={
                    editable ? popup === "participants" : undefined
                  }
                  aria-controls={
                    popup === "participants" ? peoplePopupId : undefined
                  }
                  placeholder={
                    values.participantIds.length
                      ? `참여자 · ${values.participantIds.length}명`
                      : "참여자"
                  }
                  value={
                    editable
                      ? popup === "participants"
                        ? peopleSearch
                        : ""
                      : draft.event?.participants
                          .map((p) => p.name)
                          .join(", ") || ""
                  }
                  disabled={busy}
                  readOnly={!editable}
                  onClick={() => editable && setPopup("participants")}
                  onFocus={() => editable && setPopup("participants")}
                  onChange={(e) => {
                    setPeopleSearch(e.target.value);
                    setPopup("participants");
                  }}
                  onKeyDown={(e) => {
                    if (!editable) return;
                    if (
                      e.key === "ArrowDown" ||
                      (e.key === "Enter" && popup === "participants")
                    ) {
                      e.preventDefault();
                      e.stopPropagation();
                      setPopup("participants");
                      requestAnimationFrame(() =>
                        peopleChoices.current
                          ?.querySelector<HTMLInputElement>("input")
                          ?.focus(),
                      );
                    } else if (e.key === "Escape" && popup === "participants") {
                      e.preventDefault();
                      e.stopPropagation();
                      closePopup("participants");
                    }
                  }}
                />
              </div>
              {editable && popup === "participants" && (
                <PickerPopover
                  anchor={peopleRef}
                  id={peoplePopupId}
                  className="cal-editor-popup"
                  label="참여자 선택"
                  onClose={() => closePopup("participants")}
                >
                  <div ref={peopleChoices} className="cal-option-list">
                    {matchingPeople.map((p) => (
                      <label className="calendar-check" key={p.id}>
                        <input
                          type="checkbox"
                          disabled={busy}
                          checked={values.participantIds.includes(p.id)}
                          onChange={() => pick("participantIds", p.id)}
                        />
                        {p.name}
                      </label>
                    ))}
                  </div>
                  {matchingPeople.length === 0 && (
                    <p role="status">선택할 참여자가 없습니다.</p>
                  )}
                </PickerPopover>
              )}
            </>
          )}
          {(editable || values.location.trim()) && (
            <div className="cal-editor-icon-row">
              <CalendarIcon name="location" />
              <input
                className="cal-editor-inline-row"
                aria-label="장소"
                maxLength={200}
                value={values.location}
                placeholder="장소"
                disabled={busy}
                readOnly={!editable}
                onChange={(e) => change("location", e.target.value)}
              />
            </div>
          )}
          {(editable || referenceCount > 0) && (
            <EditorPopoverRow
              label="링크 및 첨부 자료"
              icon="link"
              detail={referenceCount ? `${referenceCount}개` : undefined}
              open={popup === "links"}
              onToggle={() => togglePopup("links")}
              onClose={() => closePopup("links")}
            >
              <fieldset className="cal-editor-popup-content" disabled={busy}>
                {editable &&
                  values.links.map((link, index) => (
                    <div className="cal-link-row" key={index}>
                      <input
                        aria-label={`링크 ${index + 1} 이름`}
                        placeholder="이름"
                        maxLength={120}
                        value={link.title}
                        onChange={(e) =>
                          change(
                            "links",
                            values.links.map((l, i) =>
                              i === index ? { ...l, title: e.target.value } : l,
                            ),
                          )
                        }
                      />
                      <input
                        id={`${linkInputId}-${index}`}
                        inputMode="url"
                        aria-label={`링크 ${index + 1} 주소`}
                        placeholder="https://"
                        maxLength={2000}
                        value={link.url}
                        onChange={(e) =>
                          change(
                            "links",
                            values.links.map((l, i) =>
                              i === index ? { ...l, url: e.target.value } : l,
                            ),
                          )
                        }
                      />
                      <button
                        type="button"
                        aria-label={`링크 ${index + 1} 제거`}
                        onClick={() =>
                          change(
                            "links",
                            values.links.filter((_, i) => i !== index),
                          )
                        }
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                {editable && (
                  <button
                    type="button"
                    className="cal-inline-action"
                    disabled={values.links.length >= 10}
                    onClick={() =>
                      change("links", [...values.links, { title: "", url: "" }])
                    }
                  >
                    ＋ 링크 추가
                  </button>
                )}
                {editable && (
                  <>
                    <label>
                      자료실에서 첨부
                      <input
                        aria-label="첨부 자료 검색"
                        placeholder="자료 제목 검색"
                        value={docSearch}
                        onChange={(e) => setDocSearch(e.target.value)}
                      />
                    </label>
                    <div className="cal-option-list">
                      {documents
                        .filter((d) => d.title.includes(docSearch))
                        .slice(0, 50)
                        .map((d) => (
                          <label className="calendar-check" key={d.id}>
                            <input
                              type="checkbox"
                              checked={values.attachmentIds.includes(d.id)}
                              onChange={() => pick("attachmentIds", d.id)}
                            />
                            {d.title}
                          </label>
                        ))}
                    </div>
                    <small>
                      자료실 문서를 연결합니다. 원본 자료의 열람 권한은
                      유지됩니다.
                    </small>
                  </>
                )}
                {draft.event?.links.length ||
                draft.event?.attachments.length ? (
                  <div className="cal-editor-links">
                    {draft.event.links.map((l, i) => (
                      <a
                        key={i}
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        ↗ {l.title}
                      </a>
                    ))}
                    {draft.event.attachments.map((d) => (
                      <a
                        key={d.id}
                        href={`/api/documents/${d.id}/versions/${d.version}/download`}
                      >
                        ▤ {d.title} · v{d.version}
                      </a>
                    ))}
                  </div>
                ) : null}
              </fieldset>
            </EditorPopoverRow>
          )}
          {(editable || values.description.trim()) && (
            <div className="cal-editor-icon-row">
              <CalendarIcon name="description" />
              <textarea
                className="cal-editor-inline-row cal-editor-inline-description"
                aria-label="설명"
                rows={1}
                maxLength={2000}
                value={values.description}
                placeholder="설명"
                disabled={busy}
                readOnly={!editable}
                onChange={(e) => change("description", e.target.value)}
              />
            </div>
          )}
          <fieldset
            className="cal-editor-calendar"
            aria-label="캘린더 및 표시"
            disabled={busy || !editable}
          >
            <ColorPicker
              value={values.color}
              orgId={selectedUnit?.org_id || draft.event?.org_id || ""}
              orgName={selectedUnit?.org_name || draft.event?.org_name || ""}
              selectedOrgIds={selectedOrgIds}
              organizationColors={organizationColors}
              units={organizationOptions}
              onUnitToggle={draft.event ? undefined : toggleUnit}
              onAllToggle={draft.event ? undefined : toggleAllUnits}
              disabled={busy || !editable}
              onChange={(color) => change("color", color)}
            />
            <div className="calendar-date-inputs">
              <select
                aria-label="상태"
                value={values.availability}
                onChange={(e) =>
                  change("availability", e.target.value as "busy" | "free")
                }
              >
                <option value="busy">바쁨</option>
                <option value="free">한가함</option>
              </select>
              <select
                aria-label="정보 표시 여부"
                value={values.visibility}
                onChange={(e) =>
                  change("visibility", e.target.value as "details" | "busy")
                }
              >
                <option value="details">일정 상세 공개</option>
                <option value="busy">시간만 공개</option>
              </select>
            </div>
            {values.visibility === "busy" && !draft.event?.is_masked && (
              <small>상세는 작성자·참여자·관리권자만 볼 수 있습니다.</small>
            )}
          </fieldset>
          {(editable || values.reminders.length > 0) && (
            <EditorPopoverRow
              label="리마인더"
              icon="bell"
              detail={
                values.reminders.length
                  ? `${values.reminders.length}개`
                  : undefined
              }
              open={popup === "reminders"}
              onToggle={() => togglePopup("reminders")}
              onClose={() => closePopup("reminders")}
            >
              <fieldset
                className="cal-editor-popup-content"
                disabled={busy || !editable}
              >
                {values.reminders.map((minutes, index) => (
                  <div className="cal-reminder-row" key={index}>
                    <select
                      aria-label={`리마인더 ${index + 1}`}
                      value={minutes}
                      onChange={(e) =>
                        change(
                          "reminders",
                          values.reminders.map((m, i) =>
                            i === index ? Number(e.target.value) : m,
                          ),
                        )
                      }
                    >
                      {[0, 5, 10, 15, 30, 60, 1440, 10080].map((m) => (
                        <option key={m} value={m}>
                          {m === 0
                            ? "시작할 때"
                            : m >= 1440
                              ? `${m / 1440}일 전`
                              : `${m}분 전`}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label={`리마인더 ${index + 1} 제거`}
                      onClick={() =>
                        change(
                          "reminders",
                          values.reminders.filter((_, i) => i !== index),
                        )
                      }
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {editable && (
                  <button
                    className="cal-inline-action"
                    type="button"
                    disabled={values.reminders.length >= 3}
                    onClick={() =>
                      change("reminders", [
                        ...values.reminders,
                        [30, 10, 5].find(
                          (m) => !values.reminders.includes(m),
                        ) || 0,
                      ])
                    }
                  >
                    ＋ 리마인더 추가
                  </button>
                )}
                <small>포털이 열려 있을 때 작성자·참여자에게 표시됩니다.</small>
              </fieldset>
            </EditorPopoverRow>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {confirming && (
          <div className="calendar-delete-warning" role="alert">
            <strong>이 일정을 삭제하시겠습니까?</strong>
            <p>
              {draft.event?.recurrence
                ? "전체 반복 시리즈가 캘린더에서 사라집니다."
                : "캘린더에서 사라집니다."}{" "}
              삭제 이력은 보존됩니다.
            </p>
            <div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                삭제 취소
              </button>
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => void remove()}
              >
                삭제하기
              </button>
            </div>
          </div>
        )}
        <div className="calendar-dialog-actions">
          <span />
          <button type="button" disabled={busy} onClick={onClose}>
            {editable ? "취소" : "닫기"}
          </button>
          {editable && (
            <button
              type="submit"
              className="primary"
              disabled={busy || !values.unitIds.length || confirming}
            >
              {busy ? "저장 중…" : draft.event ? "변경 저장" : "일정 추가"}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
