from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Login(StrictModel):
    identifier: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=128)


class NewUser(StrictModel):
    name: str = Field(min_length=1, max_length=60)
    email: str = Field(pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$", max_length=254)
    identifier: str = Field(min_length=3, max_length=30)
    phone: str = Field(pattern=r"^[0-9+() -]{8,20}$")
    password: str = Field(min_length=12, max_length=128)
    unit_id: str


class Grant(StrictModel):
    user_id: str
    unit_id: str
    role: Literal[
        "head",
        "chair",
        "department_head",
        "vice_department_head",
        "class_rep",
        "manager",
        "deputy",
        "club_head",
    ]
    starts_at: datetime
    ends_at: datetime
    prerequisite_id: str | None = None
    election_note: str = Field(default="", max_length=300)


class Revoke(StrictModel):
    reason: str = Field(min_length=2, max_length=300)
