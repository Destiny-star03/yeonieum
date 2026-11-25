export { api } from "../../shared/api";
export type CalendarUnit = {
  id: string;
  name: string;
  org_id: string;
  org_name: string;
  can_create: boolean;
};
export type Repeat = {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  until: string | null;
  weekdays?: number[] | null;
  monthly_mode?: "date" | "weekday";
  count?: number | null;
};
export type PersonOption = { id: string; name: string };
export type DocumentOption = { id: string; title: string; version: number };
export type EventLink = { title: string; url: string };
export type EventCalendar = {
  unit_id: string;
  unit_name: string;
  org_id: string;
  org_name: string;
};
export type CalendarEvent = {
  external_source?: "school" | "holidays";
  source_url?: string;
  id: string;
  instance_key: string;
  occurrence_start?: string;
  time_zone: "Asia/Seoul" | "UTC";
  recurrence: Repeat | null;
  participant_ids: string[];
  participants: PersonOption[];
  links: EventLink[];
  attachment_ids: string[];
  attachments: DocumentOption[];
  reminder_minutes: number[];
  availability: "busy" | "free";
  visibility: "details" | "busy";
  color:
    | "default"
    | "sand"
    | "stone"
    | "ink"
    | "clay"
    | "red"
    | "orange"
    | "yellow"
    | "green"
    | "mint"
    | "sky"
    | "blue"
    | "violet"
    | "pink";
  is_masked: boolean;
  unit_id: string;
  title: string;
  description: string;
  location: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  revision: number;
  creator_name: string;
  can_edit: boolean;
  org_id: string;
  org_name: string;
  unit_name: string;
  calendars?: EventCalendar[];
};
export function eventCalendars(event: CalendarEvent): EventCalendar[] {
  return event.calendars?.length ? event.calendars : [event];
}
export type OccurrenceScope = "single" | "following";
export type DisplayedCalendarEvent = CalendarEvent & {
  pendingMove?: true;
  displayColor?: CalendarColor;
  displayCalendar?: EventCalendar;
};
export type Draft = {
  day: string;
  event?: CalendarEvent;
  startTime?: string;
  endTime?: string;
  endDay?: string;
  allDay?: boolean;
  occurrenceDay?: string;
  copy?: CalendarEvent;
  removeRequested?: boolean;
};
export type Reminder = {
  event: CalendarEvent;
  minutes: number;
  occurrence_start: string;
};
export type View = "day" | "week" | "month";
export type CalendarPreferences = {
  dayCount: number;
  weekends: boolean;
  weekNumbers: boolean;
  hour24: boolean;
  compact: boolean;
  zone: "Asia/Seoul" | "UTC";
};
import type { CalendarColor } from "./calendarColors";
