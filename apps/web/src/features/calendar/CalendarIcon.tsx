const paths = {
  eye: "M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  eyeOff:
    "M3 3l18 18 M10 6.2A11 11 0 0 1 12 6c6.4 0 10 6 10 6a13 13 0 0 1-3 3.3 M6.2 7.9A15.5 15.5 0 0 0 2 12s3.6 6 10 6a11 11 0 0 0 4-.8",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z M12 7v5l3 2",
  globe:
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z M3 12h18 M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z",
  repeat:
    "M4 11a8 8 0 0 1 13-5l2 2 M19 4v4h-4 M20 13a8 8 0 0 1-13 5l-2-2 M5 20v-4h4",
  person: "M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z M5 21v-2a7 4 0 0 1 14 0v2Z",
  location:
    "M19 10c0 4.5-7 11-7 11s-7-6.5-7-11a7 7 0 0 1 14 0Z M12 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z",
  link: "M10 13l4-4 M8 16l-1 1a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0 M16 8l1-1a3.5 3.5 0 0 1 5 5l-4 4a3.5 3.5 0 0 1-5 0",
  description: "M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6",
  bell: "M5 17c2-2 2-4 2-7a5 5 0 0 1 10 0c0 3 0 5 2 7H5Z M10 20a2 2 0 0 0 4 0",
};

export type CalendarIconName = keyof typeof paths;

export default function CalendarIcon({ name }: { name: CalendarIconName }) {
  return (
    <svg
      className="cal-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
