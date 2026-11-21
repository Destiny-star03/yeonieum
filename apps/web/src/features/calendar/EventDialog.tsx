import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  api,
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
import { DatePicker, TimePicker, durationLabel } from "./DateTimePickers";
import ColorPicker from "./ColorPicker";
import RepeatPicker from "./RepeatPicker";

type Props = {
  draft: Draft;
  units: CalendarUnit[];
  defaultUnit: string;
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
    : { day: draft.endDay || draft.day, time: draft.endTime || "09:30" };
  if (draft.copy) {
    const days =
      Date.parse(atMidnight(draft.day)) - Date.parse(atMidnight(start.day));
    end.day = shiftDay(end.day, Math.round(days / 86400000));
    start.day = draft.day;
  }
  return {
    title: event ? (draft.copy ? `${event.title} 사본` : event.title) : "",
    unit: event?.unit_id || defaultUnit,
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
export default function EventDialog({
  draft,
  units,
  defaultUnit,
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(Boolean(draft.removeRequested));
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [documents, setDocuments] = useState<DocumentOption[]>([]);
  const [peopleSearch, setPeopleSearch] = useState("");
  const [docSearch, setDocSearch] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const editable = !draft.event || draft.event.can_edit;
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);
  useEffect(() => {
    setValues(initial(draft, defaultUnit, defaultZone));
    setConfirming(Boolean(draft.removeRequested));
    setError("");
    setPeopleSearch("");
    setDocSearch("");
    onDirty(false);
    requestAnimationFrame(() =>
      titleRef.current?.focus({ preventScroll: true }),
    );
  }, [draft]);
  useEffect(() => {
    let alive = true;
    setPeople([]);
    setDocuments([]);
    if (values.unit && editable)
      api<{ participants: PersonOption[]; documents: DocumentOption[] }>(
        `/calendar/editor-options?${new URLSearchParams({ unit_id: values.unit })}`,
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
  }, [values.unit, editable]);
  function change<K extends keyof typeof values>(
    key: K,
    value: (typeof values)[K],
  ) {
    setValues((old) => ({ ...old, [key]: value }));
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
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editable) return;
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
    setBusy(true);
    try {
      const body = {
        unit_id: values.unit,
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
          : body,
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
                    <button type="button" onClick={() => setConfirming(true)}>
                      삭제
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
        {draft.event?.recurrence && (
          <p className="cal-editor-note">
            반복 일정의 전체 시리즈를 수정·삭제합니다.
            {draft.occurrenceDay ? ` 선택한 회차: ${draft.occurrenceDay}` : ""}
          </p>
        )}
        {draft.event?.is_masked && (
          <p className="cal-editor-note">
            세부 정보는 작성자·참여자·관리권자에게만 표시됩니다.
          </p>
        )}
        <fieldset disabled={busy || !editable} className="cal-editor-section">
          <legend>날짜와 시간</legend>
          <div className={`cal-period ${values.allDay ? "is-all-day" : ""}`}>
            <div className="cal-period-times">
              <span className="cal-period-clock" aria-hidden="true">
                ◷
              </span>
              <TimePicker
                label="시작 시간"
                value={values.startTime}
                disabled={busy || !editable || values.allDay}
                onChange={(time) => change("startTime", time)}
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
          <label className="calendar-check cal-all-day-toggle">
            <input
              type="checkbox"
              checked={values.allDay}
              onChange={(e) => change("allDay", e.target.checked)}
            />
            종일
          </label>
          {!values.allDay && (
            <label className="cal-period-zone">
              <span aria-hidden="true">◎</span>
              <select
                aria-label="시간대"
                value={values.zone}
                onChange={(e) =>
                  change("zone", e.target.value as "Asia/Seoul" | "UTC")
                }
              >
                <option value="Asia/Seoul">한국 · GMT+9</option>
                <option value="UTC">UTC · GMT+0</option>
              </select>
            </label>
          )}
        </fieldset>
        <fieldset disabled={busy || !editable} className="cal-editor-section">
          <legend>반복</legend>
          <RepeatPicker
            value={values.repeat}
            day={values.startDay}
            disabled={busy || !editable}
            onChange={(repeat) => change("repeat", repeat)}
          />
        </fieldset>
        <fieldset disabled={busy || !editable} className="cal-editor-section">
          <legend>참여자와 장소</legend>
          {editable ? (
            <details className="cal-editor-disclosure">
              <summary>
                참여자{" "}
                {values.participantIds.length > 0
                  ? `· ${values.participantIds.length}명`
                  : "추가"}
              </summary>
              <input
                aria-label="참여자 검색"
                placeholder="이름으로 검색"
                value={peopleSearch}
                onChange={(e) => setPeopleSearch(e.target.value)}
              />
              <div className="cal-option-list">
                {eventPeople
                  .filter((p) => p.name.includes(peopleSearch))
                  .map((p) => (
                    <label className="calendar-check" key={p.id}>
                      <input
                        type="checkbox"
                        checked={values.participantIds.includes(p.id)}
                        onChange={() => pick("participantIds", p.id)}
                      />
                      {p.name}
                    </label>
                  ))}
              </div>
              <small>
                포털 참여자 지정이며 외부 초대 메일은 발송하지 않습니다.
              </small>
            </details>
          ) : (
            <p className="cal-readonly-value">
              {draft.event?.participants.map((p) => p.name).join(", ") ||
                "참여자 없음"}
            </p>
          )}
          <label>
            장소
            <input
              maxLength={200}
              value={values.location}
              placeholder="위치 추가"
              onChange={(e) => change("location", e.target.value)}
            />
          </label>
        </fieldset>
        <fieldset disabled={busy || !editable} className="cal-editor-section">
          <legend>링크 및 첨부 자료</legend>
          {values.links.map((link, index) => (
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
                type="url"
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
            <details className="cal-editor-disclosure">
              <summary>
                자료실에서 첨부 · {values.attachmentIds.length}개
              </summary>
              <input
                aria-label="첨부 자료 검색"
                placeholder="자료 제목 검색"
                value={docSearch}
                onChange={(e) => setDocSearch(e.target.value)}
              />
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
                자료실 문서를 연결합니다. 원본 자료의 열람 권한은 유지됩니다.
              </small>
            </details>
          )}
        </fieldset>
        {draft.event?.links.length || draft.event?.attachments.length ? (
          <div className="cal-editor-links">
            {draft.event.links.map((l, i) => (
              <a key={i} href={l.url} target="_blank" rel="noopener noreferrer">
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
        <label>
          설명
          <textarea
            maxLength={2000}
            value={values.description}
            placeholder="설명 추가"
            disabled={busy || !editable}
            onChange={(e) => change("description", e.target.value)}
          />
        </label>
        <fieldset className="cal-editor-section" disabled={busy || !editable}>
          <legend>캘린더 및 표시</legend>
          <label>
            캘린더 · 공개 범위
            <select
              aria-label="캘린더 · 공개 범위"
              required
              value={values.unit}
              disabled={Boolean(draft.event)}
              onChange={(e) => {
                change("unit", e.target.value);
                change("participantIds", []);
              }}
            >
              <option value="">캘린더 선택</option>
              {units
                .filter((u) => u.can_create || u.id === draft.event?.unit_id)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="calendar-date-inputs">
            <label>
              상태
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
            </label>
            <label>
              정보 표시 여부
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
            </label>
          </div>
          <small>
            시간만 공개하면 상세는 작성자·참여자·관리권자만 볼 수 있습니다.
          </small>
          <ColorPicker
            value={values.color}
            orgId={units.find((u) => u.id === values.unit)?.org_id || ""}
            orgName={units.find((u) => u.id === values.unit)?.org_name || ""}
            disabled={busy || !editable}
            onChange={(color) => change("color", color)}
          />
        </fieldset>
        <fieldset className="cal-editor-section" disabled={busy || !editable}>
          <legend>리마인더</legend>
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
                  [30, 10, 5].find((m) => !values.reminders.includes(m)) || 0,
                ])
              }
            >
              ＋ 리마인더 추가
            </button>
          )}
          <small>포털이 열려 있을 때 작성자·참여자에게 표시됩니다.</small>
        </fieldset>
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
          {draft.event && editable && !confirming && (
            <button
              type="button"
              className="calendar-remove"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              일정 삭제
            </button>
          )}
          <span />
          <button type="button" disabled={busy} onClick={onClose}>
            {editable ? "취소" : "닫기"}
          </button>
          {editable && (
            <button
              type="submit"
              className="primary"
              disabled={busy || !values.unit || confirming}
            >
              {busy ? "저장 중…" : draft.event ? "변경 저장" : "일정 추가"}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
