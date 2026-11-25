"""PostgreSQL driver for the application's parameterized SQL and row interface."""

from dataclasses import dataclass, field
from pathlib import Path

from psycopg import Connection


class Row:
    def __init__(self, names, values):
        self._names = names
        self._values = tuple(values)

    def keys(self):
        return self._names

    def __getitem__(self, key):
        return self._values[self._names.index(key) if isinstance(key, str) else key]

    def __iter__(self):
        return iter(self._values)


def row_factory(cursor):
    names = tuple(column.name for column in (cursor.description or ()))
    return lambda values: Row(names, values)


class PostgresConnection(Connection):
    def execute(self, query, params=None):
        # Application statements are static SQL with positional question marks.
        if params:
            query = query.replace("%", "%%").replace("?", "%s")
        return super().execute(query, params or None)


@dataclass(frozen=True)
class PostgresDatabase:
    conninfo: str = field(repr=False)
    password_file: Path | None = None

    def connect(self):
        options = {"connect_timeout": 5}
        if self.password_file is not None:
            options["password"] = self.password_file.read_text(encoding="utf-8-sig").rstrip("\r\n")
        return PostgresConnection.connect(self.conninfo, autocommit=True, row_factory=row_factory, **options)
