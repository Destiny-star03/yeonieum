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


def recurrence_zone(row, details):
    return timezone.utc if details.get("time_zone") == "UTC" and not row["all_day"] else KST


def occurrence_starts(row, details, lower, upper, *, include_upper=False):
    zone = recurrence_zone(row, details)
    first = datetime.fromisoformat(row["starts_at"]).astimezone(zone)
    repeat = details["recurrence"]
    if upper < first or lower > upper:
        return
    until = datetime.fromisoformat(repeat["until"]).date() if repeat.get("until") else None
    for number, candidate in enumerate(candidates(first, repeat, max(first, lower).astimezone(zone)), 1):
        if candidate > upper or (candidate == upper and not include_upper):
            return
        if until and candidate.date() > until:
            return
        if repeat.get("count") is not None and number > repeat["count"]:
            return
        if candidate >= lower:
            yield candidate


MICROSECOND = timedelta(microseconds=1)
ZERO_SHIFT = (0, 0)


def following_shift(changes, key):
    following = changes.get("following", {})
    boundary = max((at for at in following if at <= key), default=None)
    return following.get(boundary, ZERO_SHIFT)


def event_duration(row):
    return datetime.fromisoformat(row["ends_at"]) - datetime.fromisoformat(row["starts_at"])


def occurrence_period(duration, original, following, single=ZERO_SHIFT):
    return (
        original + timedelta(microseconds=following[0] + single[0]),
        original + duration + timedelta(microseconds=following[1] + single[1]),
    )


def record_occurrence_change(row, details, original, start, end, scope):
    if next(occurrence_starts(row, details, original, original, include_upper=True), None) is None:
        raise HTTPException(404, "반복 회차를 찾을 수 없습니다.")
    changes = details.setdefault("occurrence_changes", {})
    following = changes.setdefault("following", {})
    singles = changes.setdefault("single", {})
    key = stamp(original)
    active = following_shift(changes, key)
    single = singles.get(key, ZERO_SHIFT)
    duration = event_duration(row)
    previous_start, previous_end = occurrence_period(duration, original, active, single)
    start_delta = (start - previous_start) // MICROSECOND
    end_delta = (end - previous_end) // MICROSECOND
    if scope == "single":
        singles[key] = (single[0] + start_delta, single[1] + end_delta)
    else:
        following.setdefault(key, active)
        for at, (start_shift, end_shift) in following.items():
            if at >= key:
                following[at] = (start_shift + start_delta, end_shift + end_delta)
        duration_us = duration // MICROSECOND
        affected = [shift for at, shift in following.items() if at >= key]
        for at, (start_shift, end_shift) in singles.items():
            if at >= key:
                forward_start, forward_end = following_shift(changes, at)
                affected.append((forward_start + start_shift, forward_end + end_shift))
        if any(
            not 0 < duration_us + end_shift - start_shift <= timedelta(days=366) // MICROSECOND
            for start_shift, end_shift in affected
        ):
            raise HTTPException(422, "이후 반복 회차의 기간이 올바르지 않습니다.")


def shift_bound(value, microseconds):
    try:
        return value + timedelta(microseconds=microseconds)
    except OverflowError:
        limit = datetime.min if microseconds < 0 else datetime.max
        return limit.replace(tzinfo=timezone.utc)


def occurrences(row, details, start, end):
    first = datetime.fromisoformat(row["starts_at"])
    duration = event_duration(row)
    if not details.get("recurrence"):
        if first < end and first + duration > start:
            yield {**dict(row), "instance_key": row["id"] + "@" + stamp(first)}
        return

    changes = details.get("occurrence_changes", {})
    singles = changes.get("single", {})
    boundaries = [
        (datetime.fromisoformat(key), shift) for key, shift in sorted(changes.get("following", {}).items())
    ]
    segments = [(None, ZERO_SHIFT), *boundaries]

    def projected(original, starts_at, ends_at):
        return {
            **dict(row),
            "starts_at": stamp(starts_at),
            "ends_at": stamp(ends_at),
            "occurrence_start": stamp(original),
            "instance_key": row["id"] + "@" + stamp(original),
        }

    for index, (boundary, shift) in enumerate(segments):
        lower = shift_bound(start, -(duration // MICROSECOND) - shift[1])
        upper = shift_bound(end, -shift[0])
        if boundary is not None:
            lower = max(lower, boundary)
        if index + 1 < len(segments):
            upper = min(upper, segments[index + 1][0])
        if lower >= upper:
            continue
        for original in occurrence_starts(row, details, lower, upper):
            if stamp(original) in singles:
                continue
            actual_start, actual_end = occurrence_period(duration, original, shift)
            if actual_end > start:
                yield projected(original, actual_start, actual_end)

    # An individually moved occurrence can be visible far from its original date.
    for key, single in singles.items():
        original = datetime.fromisoformat(key)
        shift = following_shift(changes, key)
        actual_start, actual_end = occurrence_period(duration, original, shift, single)
        if actual_start < end and actual_end > start:
            if (
                next(occurrence_starts(row, details, original, original, include_upper=True), None)
                is not None
            ):
                yield projected(original, actual_start, actual_end)
