"""Local finance workflow. Amounts are whole KRW; recorded spending is never erased by review."""

import json
from collections.abc import Callable
from datetime import date
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, StringConstraints, ValidationError
from python_multipart.multipart import parse_options_header
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser
from starlette.requests import ClientDisconnect

from yeonieum.core.database import audit, stamp, transaction
from yeonieum.core.postgres import PostgresConnection
from yeonieum.modules.budgets import evidence as receipt_storage
from yeonieum.modules.budgets.policy import (
    CAPABILITIES,
    can_view,
    has_capability,
    is_head,
    live_organization,
    org_roles,
)
from yeonieum.modules.budgets.spending_preview import MAX_PREVIEW_SIZE, preview_spending
from yeonieum.modules.documents.storage import FileStore, valid_filename


class Grant(BaseModel):
    user_id: str
    org_id: str
    capability: str
    enabled: bool


class Annual(BaseModel):
    org_id: str
    year: int = Field(ge=2000, le=2200)
    amount: int = Field(ge=0, le=10**15)
    expected_revision: int | None = None
    authorize_heads: bool = Field(default=False, strict=True)


class Event(BaseModel):
    org_id: str
    year: int = Field(ge=2000, le=2200)
    name: str = Field(min_length=1, max_length=120)
    allocation: int = Field(ge=0, le=10**15)
    event_id: str | None = None
    expected_revision: int | None = None


class Resolution(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    payee: Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)] = ""
    payment_method: Literal["", "card", "transfer", "cash", "other"] = ""


class Expense(BaseModel):
    request_id: str = Field(min_length=16, max_length=80)
    org_id: str
    year: int = Field(ge=2000, le=2200)
    event_id: str | None = None
    spent_on: date
    purpose: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
    amount: int = Field(gt=0, le=10**15)
    executor_id: str
    resolution: Resolution | None = None


MULTIPART_CHUNK_SIZE = 64 * 1024
MAX_EXPENSE_SUBMISSION_SIZE = receipt_storage.MAX_EVIDENCE_SIZE + 1024 * 1024


def receipt_error(status, message):
    return HTTPException(status, {"field": "receipt", "message": message})


async def bounded_expense_stream(request: Request):
    length_header = request.headers.get("content-length")
    declared = None
    if length_header is not None:
        try:
            if not length_header.isascii() or not length_header.isdecimal():
                raise ValueError
            declared = int(length_header)
        except ValueError:
            raise receipt_error(400, "증빙 전송 크기가 올바르지 않습니다.") from None
        if declared > MAX_EXPENSE_SUBMISSION_SIZE:
            raise receipt_error(413, "파일은 50 MiB 이하로 등록해 주세요.")

    received = 0
    async for chunk in request.stream():
        received += len(chunk)
        if received > MAX_EXPENSE_SUBMISSION_SIZE:
            raise receipt_error(413, "파일은 50 MiB 이하로 등록해 주세요.")
        if declared is not None and received > declared:
            raise receipt_error(400, "증빙 전송 크기가 올바르지 않습니다.")
        for offset in range(0, len(chunk), MULTIPART_CHUNK_SIZE):
            yield chunk[offset : offset + MULTIPART_CHUNK_SIZE]
    if declared is not None and received != declared:
        raise receipt_error(400, "증빙 전송이 완료되지 않았습니다.")


class ExpenseSubmissionParser(MultiPartParser):
    """Authorize the expense before accepting the receipt part."""

    def __init__(self, request: Request, authorize: Callable[[Expense], None]):
        super().__init__(
            request.headers,
            bounded_expense_stream(request),
            max_files=1,
            max_fields=1,
            max_part_size=MULTIPART_CHUNK_SIZE,
        )
        self.authorize = authorize
        self.expense: Expense | None = None
        self.complete = False

    def on_headers_finished(self):
        disposition, options = parse_options_header(self._current_part.content_disposition)
        name, is_file = options.get(b"name"), b"filename" in options
        if disposition != b"form-data":
            raise MultiPartException("Invalid form-data disposition.")
        if self.expense is None:
            if name == b"receipt":
                raise receipt_error(422, "지출 정보를 증빙 파일보다 먼저 보내 주세요.")
            if name != b"expense" or is_file:
                raise HTTPException(422, "지출 정보를 JSON 텍스트로 보내 주세요.")
        elif name != b"receipt" or not is_file or len(self.items) != 1:
            raise receipt_error(422, "증빙 파일은 한 개만 보내 주세요.")
        super().on_headers_finished()

    def on_part_end(self):
        super().on_part_end()
        if self.expense is None:
            try:
                data = Expense.model_validate_json(self._current_part.data)
            except ValidationError:
                raise HTTPException(422, "지출 입력 내용을 확인해 주세요.") from None
            self.authorize(data)
            self.expense = data

    def on_end(self):
        self.complete = True


async def receipt_chunks(receipt: UploadFile):
    while chunk := await receipt.read(MULTIPART_CHUNK_SIZE):
        yield chunk


class Correction(BaseModel):
    amount: int = Field(ge=0, le=10**15)
    purpose: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=500)]
    expected_revision: int = Field(ge=1)
    resolution: Resolution | None = None
    resubmit: bool = False


class Decision(BaseModel):
    decision: str
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=500)]
    expected_revision: int = Field(ge=1)


class Settle(BaseModel):
    org_id: str
    year: int = Field(ge=2000, le=2200)
    expected_revision: int = Field(ge=1)


def install_budget_routes(app, db, actor, now, storage_root):
    store = FileStore(storage_root)

    def require(conn, user, org_id, capability=None):
        if not live_organization(conn, org_id):
            raise HTTPException(404, "운영 중인 단체가 없습니다.")
        if not can_view(conn, user, org_id, now()):
            raise HTTPException(404, "예산을 찾을 수 없습니다.")
        if capability and not has_capability(conn, user, org_id, capability, now()):
            raise HTTPException(403, "해당 회계 업무 권한이 없습니다.")

    def annual(conn, org_id, year, writable=False):
        row = conn.execute(
            "SELECT * FROM annual_budgets WHERE org_id=? AND year=?", (org_id, year)
        ).fetchone()
        if not row:
            raise HTTPException(404, "연간 예산을 찾을 수 없습니다.")
        if writable and row["settled_at"]:
            raise HTTPException(409, "확정된 정산은 수정할 수 없습니다.")
        return dict(row)

    def expense(conn, ident, user, capability=None, writable=False):
        row = conn.execute("SELECT * FROM expenses WHERE id=?", (ident,)).fetchone()
        if not row or not can_view(conn, user, row["org_id"], now()):
            raise HTTPException(404, "지출을 찾을 수 없습니다.")
        require(conn, user, row["org_id"], capability)
        if writable:
            annual(conn, row["org_id"], row["year"], True)
        return expense_record(row)

    def expense_record(row):
        record = dict(row)
        record.pop("posting_order", None)
        return record

    def resolution_details(conn, ident):
        row = conn.execute(
            "SELECT title,payee,payment_method FROM expense_resolutions WHERE expense_id=?", (ident,)
        ).fetchone()
        return dict(row) if row else None

    def save_resolution(conn, ident, resolution):
        conn.execute(
            """INSERT INTO expense_resolutions(expense_id,title,payee,payment_method) VALUES (?,?,?,?)
               ON CONFLICT(expense_id) DO UPDATE SET title=excluded.title,payee=excluded.payee,
               payment_method=excluded.payment_method""",
            (ident, resolution.title, resolution.payee, resolution.payment_method),
        )

    def posting_order(conn):
        return "posting_order" if isinstance(conn, PostgresConnection) else "rowid"

    def check_revision(row, expected):
        if row["revision"] != expected:
            raise HTTPException(409, "다른 변경이 먼저 저장되었습니다. 새로고침해 주세요.")

    def recompute_exceptions(conn, org_id, year):
        budget = annual(conn, org_id, year)
        events = {
            r["id"]: r["allocation"]
            for r in conn.execute(
                "SELECT id,allocation FROM budget_events WHERE org_id=? AND year=?", (org_id, year)
            )
        }
        running, per_event = 0, {}
        for row in conn.execute(
            f"SELECT id,event_id,amount,exception_required,exception_state FROM expenses WHERE org_id=? AND year=? ORDER BY created_at,{posting_order(conn)}",
            (org_id, year),
        ):
            running += row["amount"]
            if row["event_id"]:
                per_event[row["event_id"]] = per_event.get(row["event_id"], 0) + row["amount"]
            required = running > budget["amount"] or bool(
                row["event_id"] and per_event[row["event_id"]] > events[row["event_id"]]
            )
            state = row["exception_state"]
            if required and state == "none":
                state = "pending"
            elif not required:
                state = "none"
            if int(required) != row["exception_required"] or state != row["exception_state"]:
                conn.execute(
                    "UPDATE expenses SET exception_required=?,exception_state=?,exception_by=NULL,exception_at=NULL,revision=revision+1 WHERE id=?",
                    (int(required), state, row["id"]),
                )

    def totals(rows, amount):
        actual = sum(r["amount"] for r in rows)
        return {
            "budget": amount,
            "actual": actual,
            "remaining": amount - actual,
            "excess": max(0, actual - amount),
            "pending": sum(r["amount"] for r in rows if r["review_state"] == "pending"),
            "approved": sum(r["amount"] for r in rows if r["review_state"] == "approved"),
            "rejected": sum(r["amount"] for r in rows if r["review_state"] == "rejected"),
        }

    def snapshot(conn, user, org_id, year):
        budget = conn.execute(
            "SELECT * FROM annual_budgets WHERE org_id=? AND year=?", (org_id, year)
        ).fetchone()
        events = [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM budget_events WHERE org_id=? AND year=? ORDER BY name,id", (org_id, year)
            )
        ]
        rows = [
            expense_record(r)
            for r in conn.execute(
                f"SELECT * FROM expenses WHERE org_id=? AND year=? ORDER BY spent_on DESC,created_at DESC,{posting_order(conn)} DESC",
                (org_id, year),
            )
        ]
        balance = budget["amount"] if budget else 0
        for entry in reversed(rows):
            entry["balance_before"] = balance
            balance -= entry["amount"]
            entry["balance_after"] = balance
        by_id = {row["id"]: row for row in rows}
        for row in rows:
            row["history"] = []
        for item in conn.execute(
            """SELECT a.id,a.target_id,a.action,a.at,a.detail,u.name AS actor_name
               FROM expenses e JOIN audit a ON a.target_id=e.id AND a.org_id=e.org_id
               JOIN users u ON u.id=a.actor_id WHERE e.org_id=? AND e.year=?
               AND a.action IN ('finance.expense-created','finance.expense-reviewed',
                                'finance.expense-corrected','finance.expense-resubmitted')
               ORDER BY a.at,a.id""",
            (org_id, year),
        ):
            data = json.loads(item["detail"])
            by_id[item["target_id"]]["history"].append(
                {
                    "id": item["id"],
                    "at": item["at"],
                    "actor_name": item["actor_name"],
                    "action": item["action"],
                    "decision": data.get("decision"),
                    "reason": data.get("reason"),
                }
            )
        for row in rows:
            row["resolution"] = resolution_details(conn, row["id"])
            executor = dict(conn.execute("SELECT * FROM users WHERE id=?", (row["executor_id"],)).fetchone())
            row["executor_name"] = executor["name"]
            row["exception_requires_teacher"] = bool(
                row["executor_was_head"] or is_head(conn, executor, org_id, now())
            )
            row["evidence_count"] = conn.execute(
                "SELECT count(*) FROM expense_evidence WHERE expense_id=?", (row["id"],)
            ).fetchone()[0]
            row["changes"] = [
                dict(change)
                for change in conn.execute(
                    "SELECT * FROM expense_changes WHERE expense_id=? ORDER BY changed_at,id", (row["id"],)
                )
            ]
        for event in events:
            event["totals"] = totals([r for r in rows if r["event_id"] == event["id"]], event["allocation"])
        capabilities = {cap: has_capability(conn, user, org_id, cap, now()) for cap in CAPABILITIES}
        settlements = [
            {"id": row["id"], "created_at": row["created_at"]}
            for row in conn.execute(
                "SELECT id,created_at FROM settlement_snapshots WHERE org_id=? AND year=? ORDER BY created_at DESC",
                (org_id, year),
            )
        ]
        return {
            "budget": dict(budget) if budget else None,
            "events": events,
            "expenses": rows,
            "totals": totals(rows, budget["amount"]) if budget else None,
            "capabilities": capabilities,
            "is_head": is_head(conn, user, org_id, now()),
            "is_admin": bool(user["is_admin"]),
            "settlements": settlements,
        }

    @app.get("/api/budgets/options")
    def options(user=Depends(actor), conn=Depends(db)):
        orgs = [
            {"id": r["id"], "name": r["name"]}
            for r in conn.execute("SELECT * FROM units WHERE kind='organization' AND active=1 ORDER BY name")
            if can_view(conn, user, r["id"], now())
        ]
        people = {
            org["id"]: sorted(
                [
                    {"id": r["id"], "name": r["name"]}
                    for r in conn.execute("SELECT id,name FROM users WHERE active=1 AND email_verified=1")
                    if org_roles(conn, dict(r), org["id"], now())
                ],
                key=lambda r: (r["name"], r["id"]),
            )
            for org in orgs
        }
        grants = []
        if user["is_admin"]:
            grants = [
                {
                    **dict(r),
                    "active": int(
                        has_capability(
                            conn,
                            dict(conn.execute("SELECT * FROM users WHERE id=?", (r["user_id"],)).fetchone()),
                            r["org_id"],
                            r["capability"],
                            now(),
                        )
                    ),
                }
                for r in conn.execute("SELECT * FROM finance_grants ORDER BY org_id,user_id,capability")
            ]
        return {"organizations": orgs, "people": people, "grants": grants}

    @app.post("/api/budgets/grants")
    def set_grant(data: Grant, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            if not user["is_admin"] or data.capability not in CAPABILITIES:
                raise HTTPException(403, "선생님만 회계 업무 권한을 설정할 수 있습니다.")
            if not live_organization(conn, data.org_id):
                raise HTTPException(422, "운영 중인 단체를 선택해 주세요.")
            target = conn.execute(
                "SELECT * FROM users WHERE id=? AND active=1 AND email_verified=1", (data.user_id,)
            ).fetchone()
            if not target or not (target["is_admin"] or org_roles(conn, dict(target), data.org_id, now())):
                raise HTTPException(422, "해당 단체의 현재 담당자만 지정할 수 있습니다.")
            linked = (
                None if target["is_admin"] else org_roles(conn, dict(target), data.org_id, now())[0]["id"]
            )
            conn.execute(
                "INSERT INTO finance_grants VALUES (?,?,?,?,?) ON CONFLICT(user_id,org_id,capability) DO UPDATE SET assignment_id=excluded.assignment_id,active=excluded.active",
                (data.user_id, data.org_id, data.capability, linked, int(data.enabled)),
            )
            audit(conn, user, data.org_id, "finance.grant-changed", data.user_id, data.model_dump())
        return {"ok": True}

    @app.get("/api/budgets/overview")
    def overview(year: int = Query(ge=2000, le=2200), user=Depends(actor), conn=Depends(db)):
        result = []
        for org in conn.execute(
            "SELECT id,name FROM units WHERE kind='organization' AND active=1 ORDER BY name"
        ):
            if not can_view(conn, user, org["id"], now()):
                continue
            budget = conn.execute(
                "SELECT * FROM annual_budgets WHERE org_id=? AND year=?", (org["id"], year)
            ).fetchone()
            rows = conn.execute(
                "SELECT amount,review_state FROM expenses WHERE org_id=? AND year=?", (org["id"], year)
            ).fetchall()
            result.append(
                {
                    "org_id": org["id"],
                    "name": org["name"],
                    "configured": bool(budget),
                    "settled": bool(budget and budget["settled_at"]),
                    "expense_count": len(rows),
                    "totals": totals(rows, budget["amount"] if budget else 0),
                }
            )
        return {"year": year, "items": result}

    @app.post("/api/budgets/import-preview")
    async def import_preview(
        request: Request,
        org_id: str,
        year: int = Query(ge=2000, le=2200),
        filename: str = Query(max_length=180),
        user=Depends(actor),
        conn=Depends(db),
    ):
        require(conn, user, org_id, "record")
        require(conn, user, org_id, "evidence")
        annual(conn, org_id, year, True)
        valid_filename(filename)
        content = bytearray()
        async for chunk in request.stream():
            content.extend(chunk)
            if len(content) > MAX_PREVIEW_SIZE:
                raise HTTPException(413, "자동 읽기 파일은 5 MiB 이하로 선택해 주세요.")
        user = actor(request, conn)
        require(conn, user, org_id, "record")
        require(conn, user, org_id, "evidence")
        annual(conn, org_id, year, True)
        return preview_spending(bytes(content), filename)

    @app.get("/api/budgets/{org_id}/{year}")
    def detail(org_id: str, year: int, user=Depends(actor), conn=Depends(db)):
        require(conn, user, org_id)
        return snapshot(conn, user, org_id, year)

    @app.get("/api/budgets/history/settlements/{ident}")
    def settlement_history(ident: str, user=Depends(actor), conn=Depends(db)):
        row = conn.execute("SELECT * FROM settlement_snapshots WHERE id=?", (ident,)).fetchone()
        if not row or not can_view(conn, user, row["org_id"], now()):
            raise HTTPException(404, "정산 기록을 찾을 수 없습니다.")
        return {
            "id": row["id"],
            "created_at": row["created_at"],
            "snapshot": json.loads(row["snapshot_json"]),
        }

    @app.post("/api/budgets/annual")
    def set_annual(data: Annual, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            require(conn, user, data.org_id, "plan")
            if data.authorize_heads and not user["is_admin"]:
                raise HTTPException(403, "책임자 회계 권한은 선생님만 부여할 수 있습니다.")
            row = conn.execute(
                "SELECT * FROM annual_budgets WHERE org_id=? AND year=?", (data.org_id, data.year)
            ).fetchone()
            if row:
                annual(conn, data.org_id, data.year, True)
                check_revision(row, data.expected_revision)
                allocated = conn.execute(
                    "SELECT coalesce(sum(allocation),0) FROM budget_events WHERE org_id=? AND year=?",
                    (data.org_id, data.year),
                ).fetchone()[0]
                if allocated > data.amount:
                    raise HTTPException(422, "행사 배정 합계보다 연간 예산을 줄일 수 없습니다.")
                conn.execute(
                    "UPDATE annual_budgets SET amount=?,revision=revision+1 WHERE org_id=? AND year=?",
                    (data.amount, data.org_id, data.year),
                )
                recompute_exceptions(conn, data.org_id, data.year)
            else:
                if data.expected_revision is not None:
                    raise HTTPException(409, "예산을 새로고침해 주세요.")
                conn.execute(
                    "INSERT INTO annual_budgets(org_id,year,amount) VALUES (?,?,?)",
                    (data.org_id, data.year, data.amount),
                )
            if data.authorize_heads:
                for person in conn.execute("SELECT * FROM users WHERE active=1 AND email_verified=1"):
                    roles = [
                        r
                        for r in org_roles(conn, dict(person), data.org_id, now())
                        if r["role"] in {"head", "chair"}
                    ]
                    if not roles:
                        continue
                    for capability in ("view", "record", "evidence"):
                        conn.execute(
                            "INSERT INTO finance_grants VALUES (?,?,?,?,1) ON CONFLICT(user_id,org_id,capability) DO UPDATE SET assignment_id=excluded.assignment_id,active=1",
                            (person["id"], data.org_id, capability, roles[0]["id"]),
                        )
                        audit(
                            conn,
                            user,
                            data.org_id,
                            "finance.grant-changed",
                            person["id"],
                            {
                                "user_id": person["id"],
                                "org_id": data.org_id,
                                "capability": capability,
                                "enabled": True,
                                "source": "annual-budget",
                                "assignment_id": roles[0]["id"],
                            },
                        )
            audit(
                conn,
                user,
                data.org_id,
                "finance.annual-changed",
                f"{data.org_id}:{data.year}",
                {"before": row["amount"] if row else None, "after": data.amount},
            )
        return snapshot(conn, user, data.org_id, data.year)

    @app.post("/api/budgets/events")
    def set_event(data: Event, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            require(conn, user, data.org_id, "plan")
            budget = annual(conn, data.org_id, data.year, True)
            old = None
            if data.event_id:
                old = conn.execute(
                    "SELECT * FROM budget_events WHERE id=? AND org_id=? AND year=?",
                    (data.event_id, data.org_id, data.year),
                ).fetchone()
                if not old:
                    raise HTTPException(404, "행사를 찾을 수 없습니다.")
                check_revision(old, data.expected_revision)
            elif data.expected_revision is not None:
                raise HTTPException(409, "행사를 새로고침해 주세요.")
            allocated = conn.execute(
                "SELECT coalesce(sum(allocation),0) FROM budget_events WHERE org_id=? AND year=? AND id!=?",
                (data.org_id, data.year, data.event_id or ""),
            ).fetchone()[0]
            if allocated + data.allocation > budget["amount"]:
                raise HTTPException(422, "행사 배정 합계가 연간 예산을 초과합니다.")
            ident = data.event_id or str(uuid4())
            if old:
                conn.execute(
                    "UPDATE budget_events SET name=?,allocation=?,revision=revision+1 WHERE id=?",
                    (data.name.strip(), data.allocation, ident),
                )
            else:
                conn.execute(
                    "INSERT INTO budget_events(id,org_id,year,name,allocation,created_by) VALUES (?,?,?,?,?,?)",
                    (ident, data.org_id, data.year, data.name.strip(), data.allocation, user["id"]),
                )
            recompute_exceptions(conn, data.org_id, data.year)
            audit(
                conn,
                user,
                data.org_id,
                "finance.event-changed",
                ident,
                {"before": dict(old) if old else None, "name": data.name, "allocation": data.allocation},
            )
        return snapshot(conn, user, data.org_id, data.year)

    def authorize_expense(conn, user, data, *, with_receipt=False):
        require(conn, user, data.org_id, "record")
        if with_receipt:
            require(conn, user, data.org_id, "evidence")

    def save_expense(conn, user, data: Expense, staged: receipt_storage.StagedEvidence | None = None):
        authorize_expense(conn, user, data, with_receipt=staged is not None)
        existing = conn.execute(
            "SELECT * FROM expenses WHERE created_by=? AND request_id=?", (user["id"], data.request_id)
        ).fetchone()
        submitted = data.model_dump(mode="json")
        if existing:
            if existing["org_id"] != data.org_id:
                raise HTTPException(409, "같은 요청 ID로 다른 지출을 등록할 수 없습니다.")
            # Compare against the initial submission even if the expense was corrected later.
            creation = conn.execute(
                "SELECT detail FROM audit WHERE action='finance.expense-created' AND target_id=?",
                (existing["id"],),
            ).fetchone()
            original = json.loads(creation["detail"]) if creation else dict(existing)
            original["purpose"] = original["purpose"].strip()
            if any(original.get(key) != value for key, value in submitted.items()):
                raise HTTPException(409, "같은 요청 ID로 다른 지출을 등록할 수 없습니다.")
            if staged is not None:
                receipt = conn.execute(
                    """SELECT 1 FROM expense_evidence
                       WHERE id=? AND expense_id=? AND filename=? AND checksum=?""",
                    (original.get("receipt_id"), existing["id"], staged.filename, staged.checksum),
                ).fetchone()
                if not receipt:
                    raise receipt_error(409, "같은 요청 ID에 다른 증빙을 저장할 수 없습니다.")
            return existing["id"], False

        annual(conn, data.org_id, data.year, True)
        if data.spent_on.year != data.year:
            raise HTTPException(422, "집행일과 기록 연도가 일치해야 합니다.")
        if data.event_id:
            event = conn.execute(
                "SELECT 1 FROM budget_events WHERE id=? AND org_id=? AND year=? AND active=1",
                (data.event_id, data.org_id, data.year),
            ).fetchone()
            if not event:
                raise HTTPException(422, "선택한 행사는 이 단체·연도에 없습니다.")
        executor = conn.execute(
            "SELECT * FROM users WHERE id=? AND active=1 AND email_verified=1", (data.executor_id,)
        ).fetchone()
        if not executor or not org_roles(conn, dict(executor), data.org_id, now()):
            raise HTTPException(422, "실제 집행 담당자는 현재 단체 담당자여야 합니다.")
        ident, at = str(uuid4()), stamp(now())
        conn.execute(
            "INSERT INTO expenses(id,org_id,year,event_id,spent_on,purpose,amount,executor_id,executor_was_head,created_by,request_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                ident,
                data.org_id,
                data.year,
                data.event_id,
                data.spent_on.isoformat(),
                data.purpose.strip(),
                data.amount,
                data.executor_id,
                int(is_head(conn, dict(executor), data.org_id, now())),
                user["id"],
                data.request_id,
                at,
                at,
            ),
        )
        if data.resolution:
            save_resolution(conn, ident, data.resolution)
        recompute_exceptions(conn, data.org_id, data.year)
        if staged is not None:
            row = conn.execute("SELECT * FROM expenses WHERE id=?", (ident,)).fetchone()
            receipt = receipt_storage.link_evidence(conn, user, row, staged, now())
            submitted["receipt_id"] = receipt["id"]
        audit(conn, user, data.org_id, "finance.expense-created", ident, submitted)
        return ident, True

    @app.post("/api/budgets/expenses")
    def add_expense(data: Expense, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            ident, _ = save_expense(conn, user, data)
        return {"id": ident}

    @app.post("/api/budgets/expenses/submit")
    async def submit_expense(request: Request, user=Depends(actor), conn=Depends(db)):
        content_type, _ = parse_options_header(request.headers.get("content-type"))
        if content_type != b"multipart/form-data":
            raise receipt_error(415, "지출 정보와 증빙은 multipart/form-data로 보내 주세요.")
        parser = ExpenseSubmissionParser(
            request, lambda data: authorize_expense(conn, user, data, with_receipt=True)
        )
        staged = None
        committed = False
        try:
            form = await parser.parse()
            try:
                if not parser.complete:
                    raise receipt_error(400, "증빙 전송이 완료되지 않았습니다.")
                data, receipt = parser.expense, form.get("receipt")
                if data is None:
                    raise HTTPException(422, "지출 정보를 JSON 텍스트로 보내 주세요.")
                if not isinstance(receipt, UploadFile) or not receipt.filename:
                    raise receipt_error(422, "증빙 파일을 선택해 주세요.")
                try:
                    staged = await receipt_storage.stage_evidence(
                        store, receipt.filename, receipt_chunks(receipt)
                    )
                except HTTPException as exc:
                    raise receipt_error(exc.status_code, exc.detail) from exc
            finally:
                await form.close()
            with transaction(conn):
                current_user = actor(request, conn)
                if current_user["id"] != user["id"]:
                    raise HTTPException(401, "업로드 중 세션이 변경되었습니다.")
                ident, created = save_expense(conn, current_user, data, staged)
            committed = created
            return {"id": ident}
        except (ClientDisconnect, MultiPartException) as exc:
            raise receipt_error(400, "증빙 전송 형식이 올바르지 않거나 완료되지 않았습니다.") from exc
        except OSError as exc:
            raise receipt_error(500, "증빙을 저장하지 못했습니다.") from exc
        finally:
            if staged is not None and not committed:
                staged.path.unlink(missing_ok=True)

    @app.post("/api/budgets/expenses/{ident}/correct")
    def correct_expense(ident: str, data: Correction, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            row = expense(conn, ident, user, "record", True)
            check_revision(row, data.expected_revision)
            if data.resubmit and row["review_state"] != "rejected":
                raise HTTPException(409, "반려된 결의서만 보완해 재제출할 수 있습니다.")
            old_resolution = resolution_details(conn, ident)
            before = {"amount": row["amount"], "purpose": row["purpose"], "resolution": old_resolution}
            after = {
                "amount": data.amount,
                "purpose": data.purpose,
                "resolution": data.resolution.model_dump() if data.resolution else old_resolution,
            }
            conn.execute(
                "UPDATE expenses SET amount=?,purpose=?,review_state='pending',reviewed_by=NULL,reviewed_at=NULL,revision=revision+1,updated_at=? WHERE id=?",
                (after["amount"], after["purpose"], stamp(now()), ident),
            )
            if not data.resubmit or data.amount != row["amount"]:
                conn.execute(
                    "UPDATE expenses SET exception_state='none',exception_by=NULL,exception_at=NULL WHERE id=?",
                    (ident,),
                )
                recompute_exceptions(conn, row["org_id"], row["year"])
            if data.resolution:
                save_resolution(conn, ident, data.resolution)
            conn.execute(
                "INSERT INTO expense_changes VALUES (?,?,?,?,?,?,?)",
                (
                    str(uuid4()),
                    ident,
                    user["id"],
                    stamp(now()),
                    data.reason,
                    json.dumps(before, ensure_ascii=False),
                    json.dumps(after, ensure_ascii=False),
                ),
            )
            audit(
                conn,
                user,
                row["org_id"],
                "finance.expense-resubmitted" if data.resubmit else "finance.expense-corrected",
                ident,
                {
                    "before": before,
                    "after": after,
                    "reason": data.reason,
                },
            )
        return {"ok": True}

    @app.post("/api/budgets/expenses/{ident}/review")
    def review(ident: str, data: Decision, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            row = expense(conn, ident, user, "review", True)
            check_revision(row, data.expected_revision)
            if data.decision not in {"approved", "rejected"}:
                raise HTTPException(422, "확인 또는 반려를 선택해 주세요.")
            if row["review_state"] != "pending":
                raise HTTPException(409, "이미 처리한 검토입니다. 정정 후 다시 확인할 수 있습니다.")
            conn.execute(
                "UPDATE expenses SET review_state=?,reviewed_by=?,reviewed_at=?,revision=revision+1 WHERE id=?",
                (data.decision, user["id"], stamp(now()), ident),
            )
            audit(
                conn,
                user,
                row["org_id"],
                "finance.expense-reviewed",
                ident,
                {"decision": data.decision, "reason": data.reason},
            )
        return {"ok": True}

    @app.post("/api/budgets/expenses/{ident}/exception")
    def decide_exception(ident: str, data: Decision, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            row = expense(conn, ident, user, writable=True)
            check_revision(row, data.expected_revision)
            if row["exception_state"] != "pending" or data.decision not in {"approved", "rejected"}:
                raise HTTPException(409, "처리할 초과분이 없습니다.")
            executor = dict(conn.execute("SELECT * FROM users WHERE id=?", (row["executor_id"],)).fetchone())
            head_case = row["executor_was_head"] or is_head(conn, executor, row["org_id"], now())
            if head_case:
                allowed = bool(user["is_admin"])
            else:
                allowed = is_head(conn, user, row["org_id"], now()) and user["id"] != row["executor_id"]
            if not allowed:
                raise HTTPException(403, "초과분 확인 담당자가 아닙니다.")
            conn.execute(
                "UPDATE expenses SET exception_state=?,exception_by=?,exception_at=?,revision=revision+1 WHERE id=?",
                (data.decision, user["id"], stamp(now()), ident),
            )
            audit(
                conn,
                user,
                row["org_id"],
                "finance.exception-reviewed",
                ident,
                {"decision": data.decision, "reason": data.reason},
            )
        return {"ok": True}

    @app.post("/api/budgets/settle")
    def settle(data: Settle, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            require(conn, user, data.org_id)
            if not user["is_admin"]:
                raise HTTPException(403, "선생님만 전체 정산을 확정할 수 있습니다.")
            budget = annual(conn, data.org_id, data.year, True)
            check_revision(budget, data.expected_revision)
            unresolved = conn.execute(
                "SELECT 1 FROM expenses e WHERE e.org_id=? AND e.year=? AND (e.review_state='pending' OR e.exception_state='pending' OR NOT EXISTS (SELECT 1 FROM expense_evidence v WHERE v.expense_id=e.id)) LIMIT 1",
                (data.org_id, data.year),
            ).fetchone()
            if unresolved:
                raise HTTPException(409, "미검토·초과분 미처리·증빙 없는 지출이 남아 있습니다.")
            result = snapshot(conn, user, data.org_id, data.year)
            at = stamp(now())
            conn.execute(
                "UPDATE annual_budgets SET settled_at=?,settled_by=?,revision=revision+1 WHERE org_id=? AND year=?",
                (at, user["id"], data.org_id, data.year),
            )
            ident = str(uuid4())
            conn.execute(
                "INSERT INTO settlement_snapshots VALUES (?,?,?,?,?,?)",
                (ident, data.org_id, data.year, json.dumps(result, ensure_ascii=False), user["id"], at),
            )
            audit(
                conn,
                user,
                data.org_id,
                "finance.settled",
                ident,
                {"year": data.year, "totals": result["totals"]},
            )
        return {"id": ident}

    @app.get("/api/budgets/expenses/{ident}/evidence")
    def evidence_list(ident: str, user=Depends(actor), conn=Depends(db)):
        expense(conn, ident, user, "evidence")
        return [
            {
                **{k: r[k] for k in ("id", "filename", "size", "checksum", "created_by", "created_at")},
                "previewable": receipt_storage.is_previewable(r["filename"]),
            }
            for r in conn.execute(
                "SELECT * FROM expense_evidence WHERE expense_id=? ORDER BY created_at", (ident,)
            )
        ]

    @app.put("/api/budgets/expenses/{ident}/evidence")
    async def add_evidence(
        ident: str, request: Request, filename: str, user=Depends(actor), conn=Depends(db)
    ):
        expense(conn, ident, user, "evidence", True)
        upload = await receipt_storage.stage_evidence(store, filename, request.stream())
        linked = False
        try:
            with transaction(conn):
                current_user = actor(request, conn)
                row = expense(conn, ident, current_user, "evidence", True)
                existing = conn.execute(
                    """SELECT id,size,checksum FROM expense_evidence
                       WHERE expense_id=? AND filename=? AND checksum=?""",
                    (ident, upload.filename, upload.checksum),
                ).fetchone()
                if existing:
                    return dict(existing)
                result = receipt_storage.link_evidence(conn, current_user, row, upload, now())
            linked = True
            return result
        finally:
            if not linked:
                upload.path.unlink(missing_ok=True)

    def serve_evidence(ident, user, conn, *, inline):
        row = conn.execute(
            "SELECT v.*,e.org_id FROM expense_evidence v JOIN expenses e ON e.id=v.expense_id WHERE v.id=?",
            (ident,),
        ).fetchone()
        if not row or not can_view(conn, user, row["org_id"], now()):
            raise HTTPException(404, "증빙을 찾을 수 없습니다.")
        require(conn, user, row["org_id"], "evidence")
        response = receipt_storage.evidence_response(store, row, inline=inline)
        with transaction(conn):
            audit(
                conn,
                user,
                row["org_id"],
                "finance.evidence-preview-authorized" if inline else "finance.evidence-download-authorized",
                ident,
                {"expense_id": row["expense_id"]},
            )
        return response

    @app.get("/api/budgets/evidence/{ident}/preview")
    def preview_evidence(ident: str, user=Depends(actor), conn=Depends(db)):
        return serve_evidence(ident, user, conn, inline=True)

    @app.get("/api/budgets/evidence/{ident}/download")
    def download_evidence(ident: str, user=Depends(actor), conn=Depends(db)):
        return serve_evidence(ident, user, conn, inline=False)
