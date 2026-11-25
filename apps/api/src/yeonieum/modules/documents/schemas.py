import unicodedata

from pydantic import Field, field_validator

from yeonieum.modules.access.schemas import StrictModel

MAX_FILE_SIZE = 200 * 1024 * 1024


class Metadata(StrictModel):
    unit_id: str
    title: str = Field(min_length=1, max_length=150)
    description: str = Field(default="", max_length=2000)
    academic_year: int = Field(ge=1900, le=2200)
    category: str = Field(default="일반 자료", min_length=1, max_length=60)
    folder: str = Field(default="", max_length=120)
    event: str = Field(default="", max_length=120)
    audience: str = Field(default="unit", max_length=100)
    folder_id: str | None = Field(default=None, max_length=100)

    @field_validator("title", "category", "folder", "event", "description")
    @classmethod
    def normalize(cls, value):
        value = unicodedata.normalize("NFKC", value).strip()
        if any(unicodedata.category(c) == "Cc" and c not in "\n\t" for c in value):
            raise ValueError("제어 문자는 사용할 수 없습니다.")
        return value

    @field_validator("title", "category")
    @classmethod
    def not_blank(cls, value):
        if not value:
            raise ValueError("제목과 자료 종류를 입력해 주세요.")
        return value


class Upload(StrictModel):
    metadata: Metadata | None = None
    document_id: str | None = None
    expected_revision: int | None = Field(default=None, ge=1)
    filename: str = Field(min_length=1, max_length=180)
    size: int = Field(ge=1, le=MAX_FILE_SIZE, strict=True)
    checksum: str = Field(pattern=r"^[a-f0-9]{64}$")
    note: str = Field(default="", max_length=500)


class Update(StrictModel):
    metadata: Metadata
    expected_revision: int = Field(ge=1)


class Change(StrictModel):
    expected_revision: int = Field(ge=1)


class Move(Change):
    folder_id: str | None = Field(min_length=1, max_length=100)


class RestoreVersion(Change):
    version: int = Field(ge=1)


class StaffScope(StrictModel):
    unit_id: str
    enabled: bool = Field(strict=True)


class Folder(StrictModel):
    org_id: str
    academic_year: int = Field(ge=1900, le=2200)
    parent_id: str | None = None
    name: str = Field(min_length=1, max_length=100)
    audience: str = Field(pattern="^(private|organization)$")

    @field_validator("name")
    @classmethod
    def folder_name(cls, value):
        value = unicodedata.normalize("NFKC", value).strip()
        if (
            not value
            or value in {".", ".."}
            or any(unicodedata.category(c).startswith("C") or c in "/\\" for c in value)
        ):
            raise ValueError("폴더 이름에는 경로·제어 문자를 사용할 수 없습니다.")
        return value
