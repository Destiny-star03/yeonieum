import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Repeat } from "./api";
import { DatePicker, PickerPopover } from "./DateTimePickers";

const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
function weekday(day: string) {
  return new Date(`${day}T12:00Z`).getUTCDay();
}
export function repeatLabel(rule: Repeat | null, day: string): string {
  if (!rule) return "반복하지 않음";
  const unit = { daily: "일", weekly: "주", monthly: "개월", yearly: "년" }[
    rule.frequency
  ];
  let text = `${rule.interval}${unit}마다`;
  if (rule.frequency === "weekly")
    text += ` ${(rule.weekdays || [weekday(day)]).map((d) => weekdays[d]).join("·")}`;
  if (rule.frequency === "monthly")
    text +=
      rule.monthly_mode === "weekday"
        ? ` ${Math.ceil(Number(day.slice(8)) / 7)}번째 ${weekdays[weekday(day)]}`
        : ` ${Number(day.slice(8))}일`;
  if (rule.frequency === "yearly")
    text += ` ${Number(day.slice(5, 7))}월 ${Number(day.slice(8))}일`;
  if (rule.until) text += ` · ${rule.until}까지`;
  if (rule.count) text += ` · ${rule.count}회`;
  return text;
}
function normalized(rule: Repeat | null, day: string) {
  return rule
    ? JSON.stringify([
        rule.frequency,
        rule.interval,
        rule.until || null,
        rule.count || null,
        rule.monthly_mode || "date",
        rule.frequency === "weekly"
          ? [...(rule.weekdays || [weekday(day)])].sort()
          : null,
      ])
    : "none";
}
export default function RepeatPicker({
  value,
  day,
  disabled,
  emptyLabel = "반복하지 않음",
  onChange,
}: {
  value: Repeat | null;
  day: string;
  disabled: boolean;
  emptyLabel?: string;
  onChange: (value: Repeat | null) => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false),
    [custom, setCustom] = useState(false);
  const id = useId();
  const weekly = (interval: number, days = [weekday(day)]): Repeat => ({
    frequency: "weekly",
    interval,
    weekdays: days,
    until: null,
  });
  const options: (Repeat | null)[] = [
    null,
    { frequency: "daily", interval: 1, until: null },
    weekly(1, [1, 2, 3, 4, 5]),
    weekly(1),
    weekly(2),
    { frequency: "monthly", interval: 1, until: null },
    { frequency: "monthly", interval: 1, monthly_mode: "weekday", until: null },
    { frequency: "yearly", interval: 1, until: null },
  ];
  useEffect(() => {
    if (open && !disabled)
      (
        menu.current?.querySelector<HTMLButtonElement>(
          '[aria-checked="true"]',
        ) || menu.current?.querySelector<HTMLButtonElement>("button")
      )?.focus();
  }, [open, disabled]);
  function close() {
    setOpen(false);
    anchor.current?.focus({ preventScroll: true });
  }
  return (
    <div className="cal-repeat-field">
      <span>반복 설정</span>
      <button
        ref={anchor}
        type="button"
        className="cal-repeat-trigger"
        aria-label="반복 설정"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">↻</span>
        <span>{value ? repeatLabel(value, day) : emptyLabel}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && !disabled && (
        <PickerPopover
          anchor={anchor}
          onClose={() => setOpen(false)}
          className="cal-repeat-picker"
          id={id}
          label="반복 설정 선택"
        >
          <div
            ref={menu}
            role="menu"
            aria-label="반복 주기"
            onKeyDown={(e) => {
              const buttons = [
                ...menu.current!.querySelectorAll<HTMLButtonElement>("button"),
              ];
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const direction =
                e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
              if (direction || e.key === "Home" || e.key === "End") {
                e.preventDefault();
                buttons[
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? buttons.length - 1
                      : (index + direction + buttons.length) % buttons.length
                ]?.focus();
              }
            }}
          >
            {options.map((rule, i) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={normalized(rule, day) === normalized(value, day)}
                key={i}
                onClick={() => {
                  onChange(rule);
                  close();
                }}
              >
                <span aria-hidden="true">
                  {normalized(rule, day) === normalized(value, day) ? "✓" : ""}
                </span>
                {i === 2 ? "평일마다 월~금" : repeatLabel(rule, day)}
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              className="cal-repeat-custom"
              onClick={() => {
                setOpen(false);
                setCustom(true);
              }}
            >
              사용자 지정…
            </button>
          </div>
        </PickerPopover>
      )}
      {custom && !disabled && (
        <CustomRepeat
          initial={value}
          day={day}
          onClose={() => {
            setCustom(false);
            anchor.current?.focus({ preventScroll: true });
          }}
          onDone={(rule) => {
            onChange(rule);
            setCustom(false);
            anchor.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </div>
  );
}

function CustomRepeat({
  initial,
  day,
  onClose,
  onDone,
}: {
  initial: Repeat | null;
  day: string;
  onClose: () => void;
  onDone: (rule: Repeat) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [frequency, setFrequency] = useState<Repeat["frequency"]>(
    initial?.frequency || "weekly",
  );
  const [interval, setInterval] = useState(initial?.interval || 1);
  const [days, setDays] = useState(initial?.weekdays || [weekday(day)]);
  const [monthlyMode, setMonthlyMode] = useState<"date" | "weekday">(
    initial?.monthly_mode || "date",
  );
  const [end, setEnd] = useState<"never" | "until" | "count">(
    initial?.until ? "until" : initial?.count ? "count" : "never",
  );
  const [until, setUntil] = useState(initial?.until || day),
    [count, setCount] = useState(initial?.count || 4);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="cal-repeat-dialog"
      aria-labelledby="custom-repeat-title"
      onKeyDown={(e) => e.stopPropagation()}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (frequency === "weekly" && !days.length) {
            setError("반복할 요일을 하나 이상 선택해 주세요.");
            return;
          }
          if (end === "until" && until < day) {
            setError("종료일은 시작일 이후여야 합니다.");
            return;
          }
          onDone({
            frequency,
            interval,
            until: end === "until" ? until : null,
            count: end === "count" ? count : null,
            weekdays: frequency === "weekly" ? [...days].sort() : null,
            monthly_mode: frequency === "monthly" ? monthlyMode : "date",
          });
        }}
      >
        <h2 id="custom-repeat-title">반복</h2>
        <div className="cal-repeat-interval">
          <input
            aria-label="반복 간격"
            type="number"
            min={1}
            max={12}
            required
            value={interval}
            onChange={(e) => setInterval(Number(e.target.value))}
          />
          <select
            aria-label="반복 단위"
            value={frequency}
            onChange={(e) =>
              setFrequency(e.target.value as Repeat["frequency"])
            }
          >
            <option value="daily">일</option>
            <option value="weekly">주</option>
            <option value="monthly">개월</option>
            <option value="yearly">년</option>
          </select>
          <span>마다</span>
        </div>
        {frequency === "weekly" && (
          <div
            className="cal-repeat-weekdays"
            role="group"
            aria-label="반복 요일"
          >
            {weekdays.map((name, index) => (
              <button
                type="button"
                key={name}
                aria-label={`${name}요일`}
                aria-pressed={days.includes(index)}
                onClick={() =>
                  setDays(
                    days.includes(index)
                      ? days.filter((d) => d !== index)
                      : [...days, index],
                  )
                }
              >
                {name}
              </button>
            ))}
            <span>에</span>
          </div>
        )}
        {frequency === "monthly" && (
          <select
            aria-label="월간 반복 방식"
            value={monthlyMode}
            onChange={(e) =>
              setMonthlyMode(e.target.value as "date" | "weekday")
            }
          >
            <option value="date">매월 {Number(day.slice(8))}일</option>
            <option value="weekday">
              매월 {Math.ceil(Number(day.slice(8)) / 7)}번째{" "}
              {weekdays[weekday(day)]}요일
            </option>
          </select>
        )}
        <fieldset className="cal-repeat-ending">
          <legend>종료</legend>
          <label>
            <input
              type="radio"
              name="repeat-end"
              checked={end === "never"}
              onChange={() => setEnd("never")}
            />
            계속 반복
          </label>
          <div>
            <label>
              <input
                type="radio"
                name="repeat-end"
                aria-label="날짜에 종료"
                checked={end === "until"}
                onChange={() => setEnd("until")}
              />
            </label>
            <DatePicker
              label="반복 종료일"
              value={until}
              min={day}
              disabled={end !== "until"}
              onChange={setUntil}
            />
            <span>까지</span>
          </div>
          <div>
            <label>
              <input
                type="radio"
                name="repeat-end"
                aria-label="횟수 후 종료"
                checked={end === "count"}
                onChange={() => setEnd("count")}
              />
            </label>
            <input
              type="number"
              aria-label="반복 횟수"
              min={1}
              max={1000}
              required
              disabled={end !== "count"}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
            <span>회 후</span>
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="cal-repeat-dialog-actions">
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="primary">
            완료
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
