import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { CalendarEvent, CalendarUnit } from "./api";
import { PickerPopover } from "./DateTimePickers";
import {
  calendarColorHex,
  calendarPalette,
  type CalendarColor,
} from "./calendarColors";
import CalendarIcon from "./CalendarIcon";

function moveColorFocus(e: KeyboardEvent<HTMLElement>) {
  const buttons = Array.from(
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
  );
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const step = ["ArrowLeft", "ArrowUp"].includes(e.key)
    ? -1
    : ["ArrowRight", "ArrowDown"].includes(e.key)
      ? 1
      : 0;
  if (!(step || e.key === "Home" || e.key === "End")) return;
  e.preventDefault();
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? buttons.length - 1
        : (index + step + buttons.length) % buttons.length;
  buttons[next]?.focus();
}

export function CalendarScopeRow({
  org,
  color,
  visible,
  onColorChange,
  onToggle,
}: {
  org: { id: string; name: string };
  color?: CalendarColor;
  visible: boolean;
  onColorChange: (color?: CalendarColor) => void;
  onToggle: () => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const id = useId();
  const options = [
    ...calendarPalette,
    {
      value: undefined,
      name: "기본색으로 되돌리기",
      hex: calendarColorHex(org.id),
    },
  ];
  useEffect(() => {
    if (open)
      list.current
        ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
        ?.focus({ preventScroll: true });
  }, [open]);
  return (
    <div className="calendar-scope">
      <button
        ref={anchor}
        type="button"
        className="cal-scope-color"
        aria-label={`${org.name} 기본색 선택`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={`${org.name} 기본색 선택`}
        onClick={() => setOpen((current) => !current)}
      >
        <i
          className="cal-scope-swatch"
          style={{ background: calendarColorHex(org.id, color) }}
          aria-hidden="true"
        />
        <span>{org.name}</span>
      </button>
      <button
        type="button"
        className="cal-scope-visibility"
        aria-label={`${org.name} 일정 표시`}
        title={visible ? "일정 숨기기" : "일정 표시"}
        aria-pressed={visible}
        onClick={onToggle}
      >
        <CalendarIcon name={visible ? "eye" : "eyeOff"} />
      </button>
      {open && (
        <PickerPopover
          anchor={anchor}
          id={id}
          label={`${org.name} 기본색`}
          className="cal-scope-color-picker"
          onClose={() => setOpen(false)}
        >
          <div
            ref={list}
            role="radiogroup"
            aria-label="단체 기본색"
            onKeyDown={moveColorFocus}
          >
            {options.map((option) => (
              <button
                key={option.value || "default"}
                type="button"
                role="radio"
                aria-checked={color === option.value}
                tabIndex={color === option.value ? 0 : -1}
                onClick={() => {
                  onColorChange(option.value);
                  setOpen(false);
                  anchor.current?.focus({ preventScroll: true });
                }}
              >
                <i
                  className="cal-scope-swatch"
                  style={{ background: option.hex }}
                  aria-hidden="true"
                />
                <span>{option.name}</span>
                {color === option.value && (
                  <span className="cal-scope-color-check" aria-hidden="true">
                    ✓
                  </span>
                )}
              </button>
            ))}
          </div>
        </PickerPopover>
      )}
    </div>
  );
}

export default function ColorPicker({
  value,
  orgId,
  orgName,
  selectedOrgIds,
  organizationColors,
  units,
  onUnitToggle,
  onAllToggle,
  disabled,
  onChange,
}: {
  value: CalendarEvent["color"];
  orgId: string;
  orgName: string;
  selectedOrgIds: string[];
  organizationColors: ReadonlyMap<string, CalendarColor>;
  units: CalendarUnit[];
  onUnitToggle?: (id: string) => void;
  onAllToggle?: () => void;
  disabled: boolean;
  onChange: (value: CalendarEvent["color"]) => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const choices = useRef<HTMLDivElement>(null);
  const calendars = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const id = useId();
  const selected = calendarPalette.find((c) => c.value === value);
  const defaultHex = calendarColorHex(orgId, organizationColors.get(orgId));
  const allSelected =
    units.length > 0 &&
    units.every((unit) => selectedOrgIds.includes(unit.org_id));
  const selectionLabel =
    selectedOrgIds.length > 1
      ? onUnitToggle && allSelected
        ? "전체"
        : `${orgName} 외 ${selectedOrgIds.length - 1}개 단체`
      : orgName || "캘린더 선택";
  useEffect(() => {
    if (open && !disabled)
      (
        calendars.current?.querySelector<HTMLButtonElement>(
          '[aria-pressed="true"]',
        ) ||
        calendars.current?.querySelector<HTMLButtonElement>("button") ||
        choices.current?.querySelector<HTMLButtonElement>(
          '[aria-checked="true"]',
        )
      )?.focus();
  }, [open, disabled]);
  function select(next: CalendarEvent["color"]) {
    onChange(next);
    setOpen(false);
    anchor.current?.focus({ preventScroll: true });
  }
  return (
    <div className="cal-color-field">
      <button
        ref={anchor}
        type="button"
        className="cal-color-trigger"
        aria-label="캘린더 · 공개 범위 및 일정 색상"
        aria-haspopup="dialog"
        aria-expanded={open && !disabled}
        aria-controls={open && !disabled ? id : undefined}
        title={selected?.name || "단체 기본색"}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <i
          style={{ background: selected?.hex || defaultHex }}
          aria-hidden="true"
        />
        <span>{selectionLabel}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && !disabled && (
        <PickerPopover
          anchor={anchor}
          onClose={() => setOpen(false)}
          className="cal-color-picker"
          id={id}
          label="캘린더 및 일정 색상 선택"
        >
          {onUnitToggle && (
            <div
              ref={calendars}
              className="cal-dropdown-options"
              role="group"
              aria-label="단체 캘린더"
            >
              {onAllToggle && (
                <button
                  type="button"
                  aria-pressed={allSelected}
                  onClick={onAllToggle}
                >
                  <span aria-hidden="true">{allSelected ? "✓" : ""}</span>
                  전체
                </button>
              )}
              {units.map((unit) => (
                <button
                  key={unit.org_id}
                  type="button"
                  aria-pressed={selectedOrgIds.includes(unit.org_id)}
                  title={unit.id !== unit.org_id ? unit.name : undefined}
                  onClick={() => onUnitToggle(unit.id)}
                >
                  <span aria-hidden="true">
                    {selectedOrgIds.includes(unit.org_id) ? "✓" : ""}
                  </span>
                  <i
                    className="cal-scope-swatch"
                    style={{
                      background: calendarColorHex(
                        unit.org_id,
                        organizationColors.get(unit.org_id),
                      ),
                    }}
                    aria-hidden="true"
                  />
                  {unit.org_name}
                </button>
              ))}
            </div>
          )}
          <div
            ref={choices}
            role="radiogroup"
            aria-label="이벤트 색"
            onKeyDown={moveColorFocus}
          >
            {!onUnitToggle && (
              <p className="cal-color-org">
                {selectedOrgIds.length > 1
                  ? selectedOrgIds
                      .map(
                        (id) =>
                          units.find((unit) => unit.org_id === id)?.org_name,
                      )
                      .filter(Boolean)
                      .join(" · ")
                  : selectionLabel}
              </p>
            )}
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
              {calendarPalette.map((c) => (
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
