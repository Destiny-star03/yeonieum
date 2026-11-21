import { useEffect, useId, useRef, useState } from "react";
import type { CalendarEvent } from "./api";
import { PickerPopover } from "./DateTimePickers";
import { tone } from "./dates";

const colors = [
  { value: "sand", name: "샌드", hex: "#e6ded4" },
  { value: "stone", name: "스톤", hex: "#c9bfb4" },
  { value: "ink", name: "잉크", hex: "#1f1d1b" },
  { value: "clay", name: "클레이", hex: "#ead9ce" },
  { value: "red", name: "빨강", hex: "#d74c4c" },
  { value: "orange", name: "주황", hex: "#e78540" },
  { value: "yellow", name: "노랑", hex: "#edc34b" },
  { value: "green", name: "초록", hex: "#55ad7c" },
  { value: "mint", name: "민트", hex: "#8dd5c1" },
  { value: "sky", name: "하늘", hex: "#55a8d0" },
  { value: "blue", name: "파랑", hex: "#527fce" },
  { value: "violet", name: "보라", hex: "#9875d2" },
  { value: "pink", name: "분홍", hex: "#d58bb1" },
] as const;
export default function ColorPicker({
  value,
  orgId,
  orgName,
  disabled,
  onChange,
}: {
  value: CalendarEvent["color"];
  orgId: string;
  orgName: string;
  disabled: boolean;
  onChange: (value: CalendarEvent["color"]) => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const choices = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const id = useId();
  const selected = colors.find((c) => c.value === value);
  const defaultHex = ["#e6ded4", "#f0ebe5", "#6b625b", "#c9bfb4"][tone(orgId)];
  useEffect(() => {
    if (open && !disabled)
      choices.current
        ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
        ?.focus();
  }, [open, disabled]);
  function select(next: CalendarEvent["color"]) {
    onChange(next);
    setOpen(false);
    anchor.current?.focus({ preventScroll: true });
  }
  return (
    <div className="cal-color-field">
      <span>일정 색상</span>
      <button
        ref={anchor}
        type="button"
        className="cal-color-trigger"
        aria-label="일정 색상"
        aria-haspopup="dialog"
        aria-expanded={open && !disabled}
        aria-controls={open && !disabled ? id : undefined}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <i
          style={{ background: selected?.hex || defaultHex }}
          aria-hidden="true"
        />
        <span>{selected?.name || "단체 기본색"}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && !disabled && (
        <PickerPopover
          anchor={anchor}
          onClose={() => setOpen(false)}
          className="cal-color-picker"
          id={id}
          label="일정 색상 선택"
        >
          <div
            ref={choices}
            role="radiogroup"
            aria-label="이벤트 색"
            onKeyDown={(e) => {
              const buttons = [
                ...choices.current!.querySelectorAll<HTMLButtonElement>(
                  '[role="radio"]',
                ),
              ];
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const step = ["ArrowLeft", "ArrowUp"].includes(e.key)
                ? -1
                : ["ArrowRight", "ArrowDown"].includes(e.key)
                  ? 1
                  : 0;
              if (step || e.key === "Home" || e.key === "End") {
                e.preventDefault();
                buttons[
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? buttons.length - 1
                      : (index + step + buttons.length) % buttons.length
                ]?.focus();
              }
            }}
          >
            <p className="cal-color-org">{orgName || "현재 단체"}</p>
            <button
              type="button"
              role="radio"
              aria-checked={value === "default"}
              tabIndex={value === "default" ? 0 : -1}
              className="cal-color-default"
              onClick={() => select("default")}
            >
              <i style={{ background: defaultHex }} aria-hidden="true" />
              <span>단체 기본색</span>
              <span aria-hidden="true">{value === "default" ? "✓" : ""}</span>
            </button>
            <p className="cal-color-caption">이벤트 색</p>
            <div className="cal-color-swatches">
              {colors.map((c) => (
                <button
                  type="button"
                  key={c.value}
                  role="radio"
                  aria-label={c.name}
                  title={c.name}
                  aria-checked={value === c.value}
                  tabIndex={value === c.value ? 0 : -1}
                  className={`cal-color-swatch ${value === c.value ? "is-selected" : ""}`}
                  onClick={() => select(c.value)}
                >
                  <i
                    style={{
                      background: c.hex,
                      color: c.value === "ink" ? "#fffdf9" : "#1f1d1b",
                    }}
                    aria-hidden="true"
                  >
                    {value === c.value ? "✓" : ""}
                  </i>
                </button>
              ))}
            </div>
          </div>
        </PickerPopover>
      )}
    </div>
  );
}
