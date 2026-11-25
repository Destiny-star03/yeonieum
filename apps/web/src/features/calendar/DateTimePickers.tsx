import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { dayOf, minuteTime, monthDays, moveMonth, shiftDay } from "./dates";

export function durationLabel(minutes: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  return [days && `${days}일`, hours && `${hours}시간`, rest && `${rest}분`]
    .filter(Boolean)
    .join(" ");
}

// Portal placement keeps the picker outside the scrolling context panel.
export function PickerPopover({
  anchor,
  onClose,
  children,
  className,
  id,
  label,
  role = "dialog",
}: {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  className: string;
  id?: string;
  label: string;
  role?: "dialog" | "listbox";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => {
    function place() {
      if (!anchor.current || !ref.current) return;
      const a = anchor.current.getBoundingClientRect();
      const p = ref.current.getBoundingClientRect();
      const roomOnLeft = a.left - p.width >= 14;
      const roomOnRight = innerWidth - a.right - p.width >= 14;
      const top =
        roomOnLeft || roomOnRight
          ? a.top
          : a.bottom + 6 + p.height <= innerHeight - 8
            ? a.bottom + 6
            : a.top - p.height - 6;
      setPosition({
        left: roomOnLeft
          ? a.left - p.width - 6
          : roomOnRight
            ? a.right + 6
            : Math.max(8, Math.min(a.left, innerWidth - p.width - 8)),
        top: Math.max(8, Math.min(top, innerHeight - p.height - 8)),
      });
    }
    place();
    const observer = new ResizeObserver(place);
    if (anchor.current) observer.observe(anchor.current);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);
  useEffect(() => {
    function outside(e: Event) {
      const target = e.target as Node;
      if (!anchor.current?.contains(target) && !ref.current?.contains(target))
        onClose();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div
      ref={ref}
      id={id}
      role={role}
      aria-label={label}
      className={`cal-picker-popover ${className}`}
      style={position}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          anchor.current?.focus({ preventScroll: true });
          onClose();
        }
      }}
    >
      {children}
    </div>,
    anchor.current?.closest("dialog[open]") || document.body,
  );
}

export function DatePicker({
  label,
  value,
  min,
  optional = false,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  optional?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const today = dayOf(new Date().toISOString());
  const [month, setMonth] = useState(value || today);
  const [focused, setFocused] = useState(value || today);
  const anchor = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (open)
      grid.current
        ?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)
        ?.focus({ preventScroll: true });
  }, [open, focused, month]);
  function select(day: string) {
    onChange(day);
    setOpen(false);
    anchor.current?.focus({ preventScroll: true });
  }
  const compact = value
    ? `${Number(value.slice(5, 7))}월 ${Number(value.slice(8))}일(${"일월화수목금토"[new Date(`${value}T12:00:00Z`).getUTCDay()]})`
    : "종료일 없음";
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="cal-date-trigger"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={value ? `${label} · ${value}` : label}
        disabled={disabled}
        onClick={() => {
          const candidate = value || today;
          const day = min && min > candidate ? min : candidate;
          setMonth(day);
          setFocused(day);
          setOpen(!open);
        }}
      >
        {compact}
      </button>
      {open && !disabled && (
        <PickerPopover
          anchor={anchor}
          onClose={() => setOpen(false)}
          className="cal-date-picker"
          id={id}
          label={`${label} 선택`}
        >
          <header>
            <strong aria-live="polite">
              {Number(month.slice(0, 4))}년 {Number(month.slice(5, 7))}월
            </strong>
            <button
              type="button"
              aria-label="이전 달"
              onClick={() => setMonth(moveMonth(month, -1))}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="다음 달"
              onClick={() => setMonth(moveMonth(month, 1))}
            >
              ›
            </button>
          </header>
          <div className="cal-picker-weekdays" aria-hidden="true">
            {[..."일월화수목금토"].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div
            className="cal-picker-days"
            ref={grid}
            onKeyDown={(e) => {
              const offsets: Record<string, number> = {
                ArrowLeft: -1,
                ArrowRight: 1,
                ArrowUp: -7,
                ArrowDown: 7,
              };
              let day =
                e.key in offsets ? shiftDay(focused, offsets[e.key]) : "";
              if (e.key === "PageUp" || e.key === "PageDown")
                day = moveMonth(focused, e.key === "PageUp" ? -1 : 1);
              if (!day) return;
              e.preventDefault();
              if (min && day < min) day = min;
              setFocused(day);
              setMonth(day);
            }}
          >
            {monthDays(month).map((day) => (
              <button
                type="button"
                key={day}
                data-day={day}
                aria-label={day}
                aria-pressed={day === value}
                aria-current={day === today ? "date" : undefined}
                disabled={Boolean(min && day < min)}
                tabIndex={day === focused ? 0 : -1}
                className={`${day.slice(0, 7) !== month.slice(0, 7) ? "is-outside" : ""} ${day === today ? "is-today" : ""}`}
                onFocus={() => setFocused(day)}
                onClick={() => select(day)}
              >
                {Number(day.slice(8))}
              </button>
            ))}
          </div>
          <footer>
            {optional && (
              <button type="button" onClick={() => select("")}>
                종료일 지우기
              </button>
            )}
            <button
              type="button"
              disabled={Boolean(min && today < min)}
              onClick={() => select(today)}
            >
              오늘
            </button>
          </footer>
        </PickerPopover>
      )}
    </>
  );
}

export function TimePicker({
  label,
  value,
  disabled,
  onChange,
  duration,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  duration?: (time: string) => number;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const anchor = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const options = Array.from({ length: 96 }, (_, i) => minuteTime(i * 15));
  useEffect(() => {
    if (open)
      list.current
        ?.querySelector(`#${CSS.escape(`${id}-${active}`)}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);
  function show() {
    const [h, m] = value.split(":").map(Number);
    setActive(
      Number.isFinite(h + m) ? Math.min(95, Math.round((h * 60 + m) / 15)) : 0,
    );
    setOpen(true);
  }
  return (
    <>
      <input
        ref={anchor}
        className="cal-time-input"
        type="text"
        inputMode="numeric"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open && !disabled}
        aria-controls={open && !disabled ? id : undefined}
        aria-activedescendant={
          open && !disabled ? `${id}-${active}` : undefined
        }
        autoComplete="off"
        pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
        title="24시간 형식 (예: 09:30)"
        required={!disabled}
        maxLength={5}
        value={value}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) show();
            else
              setActive((old) => (old + (e.key === "ArrowDown" ? 1 : 95)) % 96);
          }
          if (e.key === "Enter" && open) {
            e.preventDefault();
            onChange(options[active]);
            setOpen(false);
          }
        }}
      />
      {open && !disabled && (
        <PickerPopover
          anchor={anchor}
          onClose={() => setOpen(false)}
          className="cal-time-picker"
          id={id}
          label={`${label} 선택`}
          role="listbox"
        >
          <div ref={list}>
            {options.map((time, index) => (
              <button
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={time === value}
                id={`${id}-${index}`}
                key={time}
                className={active === index ? "is-active" : ""}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(time);
                  setOpen(false);
                  anchor.current?.focus({ preventScroll: true });
                }}
              >
                <span>{time}</span>
                {duration && <span>{durationLabel(duration(time))}</span>}
              </button>
            ))}
          </div>
        </PickerPopover>
      )}
    </>
  );
}
