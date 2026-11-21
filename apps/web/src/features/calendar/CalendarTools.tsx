import { useEffect, useRef, useState } from "react";
import { monthDays, moveMonth } from "./dates";
export function MiniCalendar({
  anchor,
  selected,
  today,
  onSelect,
}: {
  anchor: string;
  selected: string;
  today: string;
  onSelect: (day: string) => void;
}) {
  const [month, setMonth] = useState(anchor);
  useEffect(() => setMonth(anchor), [anchor]);
  return (
    <section className="cal-mini" aria-label="작은 달력">
      <div>
        <strong>
          {Number(month.slice(0, 4))}년 {Number(month.slice(5, 7))}월
        </strong>
        <button
          aria-label="작은 달력 이전 달"
          onClick={() => setMonth(moveMonth(month, -1))}
        >
          ‹
        </button>
        <button
          aria-label="작은 달력 다음 달"
          onClick={() => setMonth(moveMonth(month, 1))}
        >
          ›
        </button>
      </div>
      <div className="cal-mini-grid">
        {["일", "월", "화", "수", "목", "금", "토"].map((w) => (
          <span key={w}>{w}</span>
        ))}
        {monthDays(month).map((day) => (
          <button
            key={day}
            aria-label={`작은 달력 ${day}`}
            aria-pressed={day === selected}
            className={`${day.slice(0, 7) !== month.slice(0, 7) ? "is-outside" : ""} ${day === today ? "is-today" : ""}`}
            onClick={() => onSelect(day)}
          >
            {Number(day.slice(8))}
          </button>
        ))}
      </div>
    </section>
  );
}
export function CommandPalette({
  open,
  onClose,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  actions: { label: string; key: string; run: () => void }[];
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (open) {
      setQuery("");
      ref.current?.showModal();
    } else ref.current?.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="cal-command-dialog"
      aria-labelledby="cal-command-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="cal-command-head">
        <h2 id="cal-command-title">명령어 메뉴</h2>
        <button aria-label="명령어 메뉴 닫기" onClick={onClose}>
          ✕
        </button>
      </div>
      <input
        autoFocus
        aria-label="명령어 검색"
        placeholder="어떤 작업을 할까요?"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div>
        {actions
          .filter((a) => a.label.includes(query))
          .map((a) => (
            <button
              key={a.label}
              onClick={() => {
                onClose();
                a.run();
              }}
            >
              <span>{a.label}</span>
              <kbd>{a.key}</kbd>
            </button>
          ))}
      </div>
    </dialog>
  );
}
export function ShortcutHelp() {
  return (
    <section className="cal-shortcuts">
      <h3>유용한 단축키</h3>
      {[
        ["명령어 메뉴", "Ctrl / ⌘ K"],
        ["새 이벤트", "C"],
        ["일 / 주 / 월 보기", "D / W / M"],
        ["오늘로 이동", "T"],
        ["원하는 날짜로 이동", "."],
        ["이벤트 검색", "/"],
        ["컨텍스트 패널", String.fromCharCode(92)],
        ["이전 / 다음 기간", "[ / ]"],
        ["일정 복사 / 붙여넣기", "Ctrl C / V"],
      ].map(([label, key]) => (
        <div key={label}>
          <span>{label}</span>
          <kbd>{key}</kbd>
        </div>
      ))}
      <p>입력 중에는 단축키가 실행되지 않습니다.</p>
    </section>
  );
}
