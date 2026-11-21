export const dayMs = 86400000;
export function localFields(value: string, zone: string = "Asia/Seoul") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}
export const dayOf = (value: string, zone: string = "Asia/Seoul") =>
  localFields(value, zone).day;
export const atMidnight = (day: string, zone: string = "Asia/Seoul") =>
  localInstant(day, "00:00", zone);
export const localInstant = (
  day: string,
  time: string,
  zone: string = "Asia/Seoul",
) =>
  new Date(`${day}T${time}:00${zone === "UTC" ? "Z" : "+09:00"}`).toISOString();
export const shiftDay = (day: string, offset: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + offset * dayMs)
    .toISOString()
    .slice(0, 10);
export function monthDays(anchor: string) {
  const first = `${anchor.slice(0, 7)}-01`;
  const start = shiftDay(first, -new Date(`${first}T12:00:00Z`).getUTCDay());
  return Array.from({ length: 42 }, (_, i) => shiftDay(start, i));
}
export function weekDays(anchor: string) {
  const start = shiftDay(anchor, -new Date(`${anchor}T12:00:00Z`).getUTCDay());
  return Array.from({ length: 7 }, (_, i) => shiftDay(start, i));
}
export function moveMonth(anchor: string, offset: number) {
  const d = new Date(`${anchor.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 10);
}
export const longDay = (day: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date(atMidnight(day)));
export const inDay = (
  event: { starts_at: string; ends_at: string },
  day: string,
) =>
  Date.parse(event.starts_at) < Date.parse(atMidnight(shiftDay(day, 1))) &&
  Date.parse(event.ends_at) > Date.parse(atMidnight(day));
export const tone = (id: string) =>
  [...id].reduce((a, c) => a + c.charCodeAt(0), 0) % 4;

export const eventKey = (event: {
  id: string;
  instance_key?: string;
  starts_at: string;
}) => event.instance_key || `${event.id}@${event.starts_at}`;
export function overlapsDay(
  event: { starts_at: string; ends_at: string; all_day: boolean },
  day: string,
  zone = "Asia/Seoul",
) {
  if (event.all_day)
    return (
      day >= dayOf(event.starts_at) &&
      day <= dayOf(new Date(Date.parse(event.ends_at) - 1).toISOString())
    );
  return (
    Date.parse(event.starts_at) <
      Date.parse(atMidnight(shiftDay(day, 1), zone)) &&
    Date.parse(event.ends_at) > Date.parse(atMidnight(day, zone))
  );
}
export function displayTime(value: string, hour24 = true, zone = "Asia/Seoul") {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
    hour12: !hour24,
  }).format(new Date(value));
}
export const minuteTime = (minute: number) =>
  `${Math.floor(minute / 60)
    .toString()
    .padStart(2, "0")}:${(minute % 60).toString().padStart(2, "0")}`;
export function weekNumber(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return Math.ceil(
    ((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / dayMs + 1) / 7,
  );
}
export function visibleDayRange(
  anchor: string,
  view: "day" | "week" | "month",
  count = 7,
  weekends = true,
) {
  if (view === "day") return [anchor];
  const result =
    view === "month"
      ? monthDays(anchor)
      : count === 7
        ? weekDays(anchor)
        : Array.from({ length: count }, (_, i) => shiftDay(anchor, i));
  return weekends
    ? result
    : result.filter(
        (d) => ![0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay()),
      );
}
