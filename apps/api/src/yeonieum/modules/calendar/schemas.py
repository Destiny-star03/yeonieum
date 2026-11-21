from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import Field, field_validator, model_validator

from yeonieum.modules.access.schemas import StrictModel

KST = timezone(timedelta(hours=9))


class Repeat(StrictModel):
    frequency: Literal["daily", "weekly", "monthly", "yearly"]
    interval: int = Field(default=1, ge=1, le=12, strict=True)
    until: date | None = None
    weekdays: list[Annotated[int, Field(ge=0, le=6, strict=True)]] | None = Field(
        default=None, min_length=1, max_length=7
    )
    monthly_mode: Literal["date", "weekday"] = "date"
    count: int | None = Field(default=None, ge=1, le=1000, strict=True)

    @model_validator(mode="after")
    def valid_rule(self):
        if self.weekdays is not None:
            if self.frequency != "weekly" or len(set(self.weekdays)) != len(self.weekdays):
                raise ValueError("주간 반복에 중복 없는 요일을 선택해 주세요.")
            self.weekdays = sorted(self.weekdays)
        if self.monthly_mode == "weekday" and self.frequency != "monthly":
            raise ValueError("몇 번째 요일 반복은 월간 반복에서만 사용할 수 있습니다.")
        if self.until and self.count is not None:
            raise ValueError("반복 종료일과 횟수 중 하나만 선택해 주세요.")
        return self


class EventLink(StrictModel):
    title: str = Field(default="링크", max_length=120)
    url: str = Field(max_length=2000)

    @field_validator("url")
    @classmethod
    def web_link(cls, value):
        parsed = urlsplit(value)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
        ):
            raise ValueError("http 또는 https 링크를 입력해 주세요.")
        return value


class EventInput(StrictModel):
    unit_id: str
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    location: str = Field(default="", max_length=200)
    time_zone: Literal["Asia/Seoul", "UTC"] = "Asia/Seoul"
    recurrence: Repeat | None = None
    participant_ids: list[str] = Field(default_factory=list, max_length=50)
    links: list[EventLink] = Field(default_factory=list, max_length=10)
    attachment_ids: list[str] = Field(default_factory=list, max_length=10)
    reminder_minutes: list[int] = Field(default_factory=list, max_length=3)
    availability: Literal["busy", "free"] = "busy"
    visibility: Literal["details", "busy"] = "details"
    color: Literal[
        "default",
        "sand",
        "stone",
        "ink",
        "clay",
        "red",
        "orange",
        "yellow",
        "green",
        "mint",
        "sky",
        "blue",
        "violet",
        "pink",
    ] = "default"
    starts_at: datetime
    ends_at: datetime
    all_day: bool = Field(default=False, strict=True)

    @field_validator("title")
    @classmethod
    def title_required(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("일정 제목을 입력해 주세요.")
        return value

    @model_validator(mode="after")
    def valid_period(self):
        if self.starts_at.tzinfo is None or self.ends_at.tzinfo is None:
            raise ValueError("일정 시간에는 시간대가 필요합니다.")
        if self.starts_at >= self.ends_at:
            raise ValueError("종료는 시작 이후여야 합니다.")
        if self.all_day and any(
            (d.hour, d.minute, d.second, d.microsecond) != (0, 0, 0, 0)
            for d in [self.starts_at.astimezone(KST), self.ends_at.astimezone(KST)]
        ):
            raise ValueError("종일 일정은 한국 시간 자정부터 다음 날 자정까지 설정해 주세요.")
        if any(type(m) is not int or m < 0 or m > 10080 for m in self.reminder_minutes):
            raise ValueError("리마인더는 시작 전 0~10080분 사이로 설정해 주세요.")
        if (
            self.recurrence
            and self.recurrence.until
            and self.recurrence.until
            < self.starts_at.astimezone(
                timezone.utc if self.time_zone == "UTC" and not self.all_day else KST
            ).date()
        ):
            raise ValueError("반복 종료일은 시작일 이후여야 합니다.")
        if self.recurrence and self.ends_at - self.starts_at > timedelta(days=366):
            raise ValueError("반복 일정 한 회차는 최대 366일입니다.")
        return self


class EventUpdate(EventInput):
    expected_revision: int = Field(ge=1, strict=True)


class EventRemove(StrictModel):
    expected_revision: int = Field(ge=1, strict=True)
    confirmed: bool = Field(strict=True)

    @field_validator("confirmed")
    @classmethod
    def confirmed_removal(cls, value):
        if not value:
            raise ValueError("일정 삭제 확인이 필요합니다.")
        return value


class ReminderRead(StrictModel):
    occurrence_start: datetime
    minutes: int = Field(ge=0, le=10080, strict=True)

    @field_validator("occurrence_start")
    @classmethod
    def aware_occurrence(cls, value):
        if value.tzinfo is None:
            raise ValueError("시간대가 필요합니다.")
        return value
