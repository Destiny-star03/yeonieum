import re
import unicodedata
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Login(StrictModel):
    identifier: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=128)


class NewUser(StrictModel):
    name: str = Field(min_length=1, max_length=60)
    email: str = Field(pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$", max_length=254)
    identifier: str = Field(pattern=r"^[0-9]{8}$")
    phone: str = Field(pattern=r"^[0-9+() -]{8,20}$")
    password: str = Field(min_length=8, max_length=128)
    unit_ids: list[str] = Field(min_length=1, max_length=20)

    @field_validator("password")
    @classmethod
    def password_rules(cls, value):
        if not any(c in "0123456789" for c in value) or not any(
            unicodedata.category(c)[0] in {"P", "S"} for c in value
        ):
            raise ValueError("비밀번호는 8자 이상이며 숫자와 특수문자를 포함해야 합니다.")
        return value

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value):
        if not isinstance(value, str):
            return value
        value = value.strip().lower()
        local, _, domain = value.partition("@")
        if (
            not local
            or local.startswith(".")
            or local.endswith(".")
            or ".." in value
            or any(c.isspace() or c in '<>"(),;:' for c in value)
        ):
            raise ValueError("이메일 주소 형식을 확인해 주세요.")
        if (
            not re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}", local)
            or not domain
            or any(
                not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", label)
                for label in domain.split(".")
            )
        ):
            raise ValueError("이메일 주소 형식을 확인해 주세요.")
        return value

    @field_validator("unit_ids")
    @classmethod
    def distinct_units(cls, value):
        return list(dict.fromkeys(value))

    @field_validator("phone", mode="before")
    @classmethod
    def phone_hyphens(cls, value):
        if isinstance(value, str) and value.isascii() and value.isdigit():
            prefix = 2 if value.startswith("02") else 3
            if len(value) in {prefix + 7, prefix + 8}:
                return f"{value[:prefix]}-{value[prefix:-4]}-{value[-4:]}"
        return value


class Grant(StrictModel):
    user_id: str
    unit_id: str
    role: str = Field(min_length=1, max_length=100)
    starts_at: datetime
    ends_at: datetime
    prerequisite_id: str | None = None
    election_note: str = Field(default="", max_length=300)


class RemoveUser(StrictModel):
    confirmation: Literal["제거하겠습니다"]


class Revoke(StrictModel):
    reason: str = Field(min_length=2, max_length=300)
