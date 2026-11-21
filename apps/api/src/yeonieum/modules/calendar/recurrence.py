"""Expand only the requested window; monthly/yearly missing dates are skipped."""

from calendar import monthrange
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from yeonieum.core.database import stamp
from yeonieum.modules.calendar.schemas import KST


def candidates(first, repeat, lower):
    frequency, interval = repeat["frequency"], repeat.get("interval", 1)
    count = repeat.get("count")
    if frequency == "weekly":
        first_weekday = (first.weekday() + 1) % 7
        week = first - timedelta(days=first_weekday)
        weekdays = sorted(repeat.get("weekdays") or [first_weekday])
        index = 0 if count else max(0, (lower - week).days // (interval * 7) - 1)
    elif frequency == "daily":
        index = 0 if count else max(0, (lower - first).days // interval)
    else:
        months = (lower.year - first.year) * 12 + lower.month - first.month
        index = 0 if count else max(0, months // (interval * (12 if frequency == "yearly" else 1)) - 1)
    for _ in range(20000):
        if frequency == "weekly":
            for weekday in weekdays:
                try:
                    candidate = week + timedelta(days=index * interval * 7 + weekday)
                except OverflowError:
                    return
                if candidate >= first:
                    yield candidate
        elif frequency == "daily":
            try:
                yield first + timedelta(days=index * interval)
            except OverflowError:
                return
        else:
            total = (
                first.year * 12 + first.month - 1 + index * interval * (12 if frequency == "yearly" else 1)
            )
            year, month = total // 12, total % 12 + 1
            if year > 9999:
                return
            day = first.day
            if frequency == "monthly" and repeat.get("monthly_mode") == "weekday":
                start_weekday = first.replace(year=year, month=month, day=1).weekday()
                day = 1 + (first.weekday() - start_weekday) % 7 + ((first.day - 1) // 7) * 7
            if day <= monthrange(year, month)[1]:
                yield first.replace(year=year, month=month, day=day)
        index += 1
    raise HTTPException(422, "반복 일정이 너무 많습니다. 조회 기간을 좁혀 주세요.")


def occurrences(row, details, start, end):
    zone = timezone.utc if details.get("time_zone") == "UTC" and not row["all_day"] else KST
    first = datetime.fromisoformat(row["starts_at"]).astimezone(zone)
    duration = datetime.fromisoformat(row["ends_at"]) - first
    repeat = details.get("recurrence")
    if not repeat:
        if first < end and first + duration > start:
            yield {**dict(row), "instance_key": row["id"] + "@" + stamp(first)}
        return
    until = datetime.fromisoformat(repeat["until"]).date() if repeat.get("until") else None
    lower = (start - duration).astimezone(zone)
    number = 0
    for candidate in candidates(first, repeat, lower):
        if candidate >= end or (until and candidate.date() > until):
            return
        number += 1
        if repeat.get("count") is not None and number > repeat["count"]:
            return
        if candidate + duration > start:
            yield {
                **dict(row),
                "starts_at": stamp(candidate),
                "ends_at": stamp(candidate + duration),
                "instance_key": row["id"] + "@" + stamp(candidate),
            }
