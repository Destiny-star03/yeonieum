const dayMs = 86_400_000;
export const formatDate = (value: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
export const seoulYear = (value: string) =>
  new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
  }).format(new Date(value));
// Storage remains [start, end). The date input is the final INCLUDED Korean day.
export const inclusiveEndInstant = (day: string) =>
  new Date(new Date(`${day}T00:00:00+09:00`).getTime() + dayMs).toISOString();
export const lastIncludedInstant = (exclusiveEnd: string) =>
  new Date(Date.parse(exclusiveEnd) - 1).toISOString();
