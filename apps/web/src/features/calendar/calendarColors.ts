import { tone } from "./dates";

export const calendarPalette = [
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

export type CalendarColor = (typeof calendarPalette)[number]["value"];

export function isCalendarColor(value: unknown): value is CalendarColor {
  return calendarPalette.some((color) => color.value === value);
}

export function calendarColorHex(orgId: string, color?: CalendarColor) {
  return (
    calendarPalette.find((option) => option.value === color)?.hex ||
    ["#e6ded4", "#f0ebe5", "#6b625b", "#c9bfb4"][tone(orgId)]
  );
}
