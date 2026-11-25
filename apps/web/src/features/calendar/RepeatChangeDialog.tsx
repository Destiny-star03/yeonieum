import { useEffect, useId, useRef, useState } from "react";
import type { CalendarPreferences, OccurrenceScope } from "./api";
import type { DropChange } from "./EventChip";
import { dayOf, displayTime, longDay } from "./dates";

function formatPeriod(
  start: number,
  end: number,
  allDay: boolean,
  preferences: CalendarPreferences,
) {
  const zone = allDay ? "Asia/Seoul" : preferences.zone;
  const first = new Date(start).toISOString();
  const last = new Date(allDay ? end - 1 : end).toISOString();
  const firstDay = dayOf(first, zone);
  const lastDay = dayOf(last, zone);

  if (allDay) {
    const period =
      firstDay === lastDay
        ? longDay(firstDay)
        : `${longDay(firstDay)} – ${longDay(lastDay)}`;
    return `${period} · 종일`;
  }

  const firstTime = displayTime(first, preferences.hour24, zone);
  const lastTime = displayTime(last, preferences.hour24, zone);
  return firstDay === lastDay
    ? `${longDay(firstDay)} · ${firstTime}–${lastTime}`
    : `${longDay(firstDay)} ${firstTime} – ${longDay(lastDay)} ${lastTime}`;
}

export default function RepeatChangeDialog({
  change,
  initialScope,
  preferences,
  saving,
  error,
  onCancel,
  onContinue,
  onConfirm,
}: {
  change: DropChange;
  initialScope: OccurrenceScope;
  preferences: CalendarPreferences;
  saving: boolean;
  error: string;
  onCancel: () => void;
  onContinue: (scope: OccurrenceScope) => void;
  onConfirm: (scope: OccurrenceScope) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [scope, setScope] = useState(initialScope);
  const { event, operation, previousStart, previousEnd, starts, ends } = change;
  const moving = operation === "move";
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="cal-repeat-change-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!saving) onCancel();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!saving) onConfirm(scope);
        }}
      >
        <h2 id={titleId}>
          반복 이벤트 “{event.title}” {moving ? "이동" : "시간 변경"}
        </h2>
        <fieldset
          className="cal-repeat-change-scopes"
          aria-label="변경 범위"
          disabled={saving}
        >
          <label>
            <input
              type="radio"
              name="occurrence-scope"
              checked={scope === "single"}
              onChange={() => setScope("single")}
              autoFocus={initialScope === "single"}
            />
            이 이벤트
          </label>
          <label>
            <input
              type="radio"
              name="occurrence-scope"
              checked={scope === "following"}
              onChange={() => setScope("following")}
              autoFocus={initialScope === "following"}
            />
            이 이벤트부터 이후 이벤트
          </label>
        </fieldset>

        <dl className="cal-repeat-change-times">
          <dt>시간</dt>
          <dd>{formatPeriod(starts, ends, event.all_day, preferences)}</dd>
          <dt>기존</dt>
          <dd>
            <s>
              {formatPeriod(
                previousStart,
                previousEnd,
                event.all_day,
                preferences,
              )}
            </s>
          </dd>
        </dl>
        {error && (
          <p role="alert" className="cal-repeat-change-error">
            {error}
          </p>
        )}

        <div className="dialog-actions cal-repeat-change-actions">
          <button
            type="button"
            className="cal-repeat-change-cancel"
            onClick={onCancel}
            disabled={saving}
          >
            변경 사항 취소
          </button>
          <button
            type="button"
            onClick={() => onContinue(scope)}
            disabled={saving}
          >
            계속 편집
          </button>
          <button type="submit" className="primary" disabled={saving}>
            {saving
              ? "저장 중…"
              : scope === "single"
                ? "이벤트 1개 저장하기"
                : "이후 이벤트 저장하기"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
