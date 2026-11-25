import { useState } from "react";
import type { LibraryOptions } from "./api";

export default function LibraryNavigation({
  years,
  year,
  org,
  mode,
  organizations,
  onYear,
  onOrg,
  onMode,
}: {
  years: number[];
  year: string;
  org: string;
  mode: "recent" | "year" | "private" | "organization" | "trash";
  organizations: LibraryOptions["organizations"];
  onYear: (year: string) => void;
  onOrg: (org: string) => void;
  onMode: (mode: "recent" | "private" | "organization" | "trash") => void;
}) {
  const [otherYear, setOtherYear] = useState("");
  const validYear =
    /^\d{4}$/.test(otherYear) &&
    Number(otherYear) >= 1900 &&
    Number(otherYear) <= 2200;
  return (
    <aside className="library-navigation" aria-label="자료 보관함">
      <div className="library-nav-primary">
        <button
          type="button"
          aria-pressed={mode === "recent"}
          onClick={() => onMode("recent")}
        >
          최근 자료
        </button>
        <button
          type="button"
          aria-pressed={mode === "private"}
          onClick={() => onMode("private")}
        >
          개인 보관
        </button>
        <button
          type="button"
          aria-pressed={mode === "trash"}
          onClick={() => onMode("trash")}
        >
          휴지통
        </button>
      </div>
      <section aria-label="연도별 자료실">
        <h2>연도별 자료</h2>
        <div className="library-nav-years">
          {years.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={String(value) === year}
              onClick={() => onYear(String(value))}
            >
              {value}년
            </button>
          ))}
        </div>
        <form
          className="library-add-year"
          onSubmit={(event) => {
            event.preventDefault();
            if (validYear) onYear(otherYear);
          }}
        >
          <input
            type="number"
            aria-label="열어볼 연도"
            placeholder="다른 연도"
            min={1900}
            max={2200}
            value={otherYear}
            onChange={(event) => setOtherYear(event.target.value)}
          />
          <button disabled={!validYear}>열기</button>
        </form>
      </section>
      {year && organizations.length > 0 && (
        <section aria-label="단체별 자료실">
          <h2>단체</h2>
          <div className="library-nav-organizations">
            <button
              type="button"
              aria-pressed={!org}
              onClick={() => onYear(year)}
            >
              전체 단체
            </button>
            {organizations.map((organization) => (
              <button
                key={organization.id}
                type="button"
                aria-pressed={org === organization.id}
                onClick={() => onOrg(organization.id)}
              >
                {organization.name}
              </button>
            ))}
          </div>
          {org && mode === "private" && (
            <button type="button" onClick={() => onMode("organization")}>
              단체 공유
            </button>
          )}
        </section>
      )}
    </aside>
  );
}
