import hashlib
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from yeonieum.core.database import connect
from yeonieum.main import create_app
from yeonieum.modules.documents.backup import copy_snapshot
from yeonieum.modules.documents.schemas import MAX_FILE_SIZE

ORIGIN = {"origin": "http://localhost:5173"}


@pytest.fixture
def library(tmp_path):
    path = tmp_path / "library.sqlite3"
    clock = [datetime(datetime.now(timezone.utc).year, 6, 1, tzinfo=timezone.utc)]
    app = create_app(path, lambda: clock[0])
    with TestClient(app, headers=ORIGIN) as client:
        sign_in(client)
        yield client, path, clock, app


def sign_in(client, name="student-chair"):
    response = client.post("/api/auth/login", json={"identifier": name, "password": "Yeonieum-demo-2026!"})
    assert response.status_code == 200


def metadata(**changes):
    return {
        "unit_id": "software",
        "title": "가상 회의록",
        "academic_year": 2026,
        "category": "회의록",
        "folder": "정기 회의",
        "event": "가상 행사",
        "description": "일반 자료",
        "audience": "unit",
        **changes,
    }


def prepare(client, content=b"synthetic v1", **changes):
    payload = {
        "metadata": metadata(),
        "filename": "meeting.txt",
        "size": len(content),
        "checksum": hashlib.sha256(content).hexdigest(),
        **changes,
    }
    return client.post("/api/documents/uploads", json=payload)


def upload(client, content=b"synthetic v1", **changes):
    response = prepare(client, content, **changes)
    assert response.status_code == 201, response.text
    saved = client.put(f"/api/documents/uploads/{response.json()['id']}/content", content=content)
    assert saved.status_code == 200, saved.text
    return saved.json()["id"]


def detail(client, ident):
    response = client.get(f"/api/documents/{ident}")
    assert response.status_code == 200, response.text
    return response.json()


def test_upload_version_restore_download_and_restart(library):
    client, path, _, app = library
    ident = upload(client)
    first = detail(client, ident)
    assert "storage_key" not in str(first)
    assert first["current_version"] == 1
    upload(client, b"synthetic v2", metadata=None, document_id=ident, expected_revision=first["revision"])
    second = detail(client, ident)
    assert second["current_version"] == 2
    assert (
        client.post(
            f"/api/documents/{ident}/restore-version",
            json={"version": 1, "expected_revision": second["revision"]},
        ).status_code
        == 200
    )
    assert len(detail(client, ident)["versions"]) == 3
    for number, expected in [(1, b"synthetic v1"), (2, b"synthetic v2"), (3, b"synthetic v1")]:
        response = client.get(f"/api/documents/{ident}/versions/{number}/download")
        assert response.content == expected
        assert response.headers["content-disposition"].startswith("attachment;")
        assert response.headers["cache-control"] == "no-store"
    with TestClient(app, headers=ORIGIN) as reopened:
        sign_in(reopened)
        assert detail(reopened, ident)["current_version"] == 3
    with connect(path) as conn:
        assert (
            conn.execute("SELECT count(*) FROM audit WHERE action='document.download-authorized'").fetchone()[
                0
            ]
            == 3
        )


def test_preview_shows_image_and_first_page_from_pdf_and_hwpx(library):
    client, _, _, _ = library
    first = Image.new("RGB", (1000, 600), "red")
    second = Image.new("RGB", (600, 1000), "blue")
    png, pdf, hwpx = BytesIO(), BytesIO(), BytesIO()
    first.save(png, "PNG")
    first.save(pdf, "PDF", save_all=True, append_images=[second])
    with ZipFile(hwpx, "w") as archive:
        archive.writestr("Contents/content.hpf", "<package/>")
        archive.writestr("Preview/PrvImage.png", png.getvalue())
    for filename, file in [("poster.png", png), ("report.pdf", pdf), ("report.hwpx", hwpx)]:
        ident = upload(client, file.getvalue(), filename=filename)
        response = client.get(f"/api/documents/{ident}/versions/1/preview")
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/jpeg"
        assert response.headers["cache-control"] == "no-store"
        with Image.open(BytesIO(response.content)) as preview:
            assert preview.size == (480, 288)
            red, green, blue = preview.getpixel((240, 144))
            assert red > 220 and green < 20 and blue < 20


def test_preview_follows_version_and_current_read_access(library):
    client, _, _, _ = library
    ident = upload(client, "첫 줄\n둘째 줄".encode(), metadata=metadata(audience="private"))
    url = f"/api/documents/{ident}/versions"
    response = client.get(f"{url}/1/preview")
    assert response.text == "첫 줄\n둘째 줄"
    assert response.headers["content-type"].startswith("text/plain")
    upload(client, b"replacement", metadata=None, document_id=ident, expected_revision=1)
    assert client.get(f"{url}/1/preview").status_code == 404
    assert client.get(f"{url}/2/preview").text == "replacement"
    sign_in(client, "student-vice")
    assert client.get(f"{url}/2/preview").status_code == 404
    sign_in(client)
    assert client.post(f"/api/documents/{ident}/trash", json={"expected_revision": 2}).status_code == 200
    assert client.get(f"{url}/2/preview").status_code == 404

    missing = upload(client, b"%PDF-cannot-render", filename="damaged.pdf")
    assert client.get(f"/api/documents/{missing}/versions/1/preview").status_code == 204


def test_reader_renders_next_pdf_page_and_reuses_local_print_pdf(library, monkeypatch):
    client, db, _, _ = library
    first = Image.new("RGB", (250, 350), "red")
    second = Image.new("RGB", (350, 250), "blue")
    pdf = BytesIO()
    first.save(pdf, "PDF", save_all=True, append_images=[second])
    ident = upload(client, pdf.getvalue(), filename="report.pdf", metadata=metadata(audience="private"))
    reader = f"/api/documents/{ident}/versions/1/read"
    assert client.get(reader).json() == {"kind": "pages", "page_count": 2}
    response = client.get(f"{reader}/pages/2")
    assert response.headers["cache-control"] == "no-store"
    with Image.open(BytesIO(response.content)) as page:
        assert page.width > page.height and page.getpixel((50, 50))[2] > 220
    assert client.get(f"{reader}/pages/3").status_code == 404
    sign_in(client, "student-vice")
    assert client.get(reader).status_code == 404
    assert client.get(f"{reader}/pages/2").status_code == 404

    sign_in(client)
    content = BytesIO()
    with ZipFile(content, "w") as archive:
        archive.writestr("Contents/content.hpf", "<package/>")
    renderer = db.parent / "tooling" / "hwp-cli-1.3.1" / ("hwp.exe" if os.name == "nt" else "hwp")
    renderer.parent.mkdir(parents=True, exist_ok=True)
    renderer.touch()
    calls = []

    def fake_render(command, **options):
        assert command[0] == str(renderer) and command[1] == "render"
        source = Path(command[2])
        assert source.name == "source.hwpx" and source.read_bytes() == content.getvalue()
        assert options["timeout"] == 25
        calls.append(source.parent)
        Path(command[4]).write_bytes(pdf.getvalue())

    from yeonieum.modules.documents import print_preview

    monkeypatch.setattr(print_preview.subprocess, "run", fake_render)
    ident = upload(client, content.getvalue(), filename="report.hwpx", metadata=metadata(audience="private"))
    reader = f"/api/documents/{ident}/versions/1/read"
    assert client.get(reader).json() == {"kind": "pages", "page_count": 2}
    assert client.get(f"{reader}/pages/2").headers["content-type"] == "image/jpeg"
    assert len(calls) == 1 and not calls[0].exists()
    sign_in(client, "student-vice")
    assert client.get(f"{reader}/pages/2").status_code == 404


def test_affiliated_user_without_role_can_upload_and_search_own_private_folders(library):
    client, _, _, _ = library
    sign_in(client, "student-new")
    target = "software-2-A"
    options = client.get("/api/documents/options").json()["units"]
    assert [row["id"] for row in options] == [target]
    assert [item["key"] for item in options[0]["audiences"]] == ["private"]
    assert prepare(client, metadata=metadata(unit_id=target, audience="organization")).status_code == 403
    assert prepare(client, metadata=metadata(unit_id="mechanical", audience="private")).status_code == 403
    parent = create_folder(client, name="가상 분류", audience="private")
    child = create_folder(client, name="회의 기록", audience="private", parent_id=parent)
    ident = upload(client, metadata=metadata(unit_id=target, audience="private", folder_id=child))
    matches = client.get("/api/documents?academic_year=2026&q=가상 분류").json()["items"]
    assert [row["id"] for row in matches] == [ident]
    folders = client.get("/api/documents/folders?academic_year=2026").json()
    assert {folder["id"] for folder in folders} == {parent, child}
    sign_in(client, "student-chair")
    assert client.get("/api/documents/folders?academic_year=2026").json() == []
    assert client.get(f"/api/documents/{ident}/versions/1/read").status_code == 404


def test_preview_uses_saved_office_cover_when_print_rendering_is_unavailable(library):
    client, _, _, _ = library
    cover, content = BytesIO(), BytesIO()
    Image.new("RGB", (300, 400), "white").save(cover, "PNG")
    with ZipFile(content, "w") as archive:
        archive.writestr("word/document.xml", "<document><p><r><t>sample</t></r></p></document>")
        archive.writestr("docProps/thumbnail.png", cover.getvalue())
    ident = upload(client, content.getvalue(), filename="sample.docx")
    url = f"/api/documents/{ident}/versions/1"
    assert client.get(f"{url}/read").json() == {"kind": "unavailable"}
    assert client.get(f"{url}/preview").headers["content-type"] == "image/jpeg"


def test_cross_org_ids_search_count_and_upload_session_are_private(library):
    client, _, _, _ = library
    ident = upload(client, metadata=metadata(title="confidential alpha"))
    session = prepare(client).json()["id"]
    sign_in(client, "student-other")
    assert client.get("/api/documents?q=confidential").json() == {"items": [], "total": 0}
    assert client.get(f"/api/documents/{ident}").status_code == 404
    assert client.get(f"/api/documents/{ident}/versions/1/download").status_code == 404
    assert client.get(f"/api/documents/uploads/{session}").status_code == 404
    assert client.put(f"/api/documents/uploads/{session}/content", content=b"synthetic v1").status_code == 404
    assert prepare(client).status_code == 403


def test_group_sharing_filters_files_and_revocation_immediately(library):
    client, _, _, _ = library
    ident = upload(client, metadata=metadata(audience="council-officers"))
    sign_in(client, "student-vice")
    assert client.get(f"/api/documents/{ident}/versions/1/download").status_code == 200
    sign_in(client, "student-rep")
    assert client.get("/api/documents").json()["total"] == 0
    assert client.get(f"/api/documents/{ident}/versions/1/download").status_code == 404
    sign_in(client)
    row = detail(client, ident)
    assert (
        client.post(
            f"/api/documents/{ident}/metadata",
            json={"metadata": metadata(audience="department:software"), "expected_revision": row["revision"]},
        ).status_code
        == 200
    )
    sign_in(client, "student-rep")
    assert client.get(f"/api/documents/{ident}/versions/1/download").status_code == 200
    sign_in(client, "student-head")
    assert client.get(f"/api/documents/{ident}").status_code == 404
    sign_in(client, "staff-demo")
    assert (
        client.post("/api/assignments/rep-role/revoke", json={"reason": "임기 종료 시연"}).status_code == 200
    )
    sign_in(client, "student-rep")
    assert client.get(f"/api/documents/{ident}/versions/1/download").status_code == 404


def test_trash_restore_does_not_destroy_versions_and_stale_writes_fail(library):
    client, _, _, _ = library
    ident = upload(client)
    assert client.post(f"/api/documents/{ident}/trash", json={"expected_revision": 1}).status_code == 200
    assert client.get("/api/documents").json()["total"] == 0
    assert client.get("/api/documents?trash=true").json()["total"] == 1
    assert client.get(f"/api/documents/{ident}/versions/1/download").status_code == 404
    assert client.post(f"/api/documents/{ident}/restore", json={"expected_revision": 1}).status_code == 409
    assert client.post(f"/api/documents/{ident}/restore", json={"expected_revision": 2}).status_code == 200
    assert detail(client, ident)["current_version"] == 1
    assert prepare(client, metadata=None, document_id=ident, expected_revision=1).status_code == 409


@pytest.mark.parametrize(
    "filename,content",
    [
        ("../escape.txt", b"x"),
        ("script.html", b"x"),
        ("file.pdf", b"wrong"),
        ("file.txt", b"\x00"),
        ("file.docx", b"PKjunk"),
    ],
)
def test_bad_names_formats_and_content_rejected_without_publishing(library, filename, content):
    client, path, _, _ = library
    prepared = prepare(client, content, filename=filename)
    if prepared.status_code == 201:
        assert (
            client.put(f"/api/documents/uploads/{prepared.json()['id']}/content", content=content).status_code
            == 422
        )
        assert client.get(f"/api/documents/uploads/{prepared.json()['id']}").json()["state"] == "REJECTED"
    else:
        assert prepared.status_code == 422
    assert client.get("/api/documents").json()["total"] == 0
    assert not list((path.parent / "library-files").glob("*"))


def test_size_limit_actual_bytes_checksum_expiry_and_replay(library):
    client, _, clock, _ = library
    assert prepare(client, size=MAX_FILE_SIZE + 1).status_code == 422
    # Exactly the limit is accepted by both contract and streaming implementation.
    content = b"a" * MAX_FILE_SIZE
    ident = upload(client, content)
    assert detail(client, ident)["size"] == MAX_FILE_SIZE
    session = prepare(client, checksum="0" * 64).json()["id"]
    assert client.put(f"/api/documents/uploads/{session}/content", content=b"synthetic v1").status_code == 422
    assert client.put(f"/api/documents/uploads/{session}/content", content=b"synthetic v1").status_code == 409
    session = prepare(client).json()["id"]
    assert (
        client.put(f"/api/documents/uploads/{session}/content", content=b"too long data").status_code == 422
    )
    session = prepare(client).json()["id"]
    clock[0] += timedelta(minutes=31)
    assert client.put(f"/api/documents/uploads/{session}/content", content=b"synthetic v1").status_code == 409


def test_prepared_upload_rechecks_role_at_completion(library):
    client, path, _, _ = library
    session = prepare(client).json()["id"]
    with connect(path) as conn:
        conn.execute(
            "UPDATE assignments SET revoked_at=? WHERE user_id='chair'",
            (datetime.now(timezone.utc).isoformat(),),
        )
    assert client.put(f"/api/documents/uploads/{session}/content", content=b"synthetic v1").status_code == 403
    assert client.get("/api/documents").json()["total"] == 0


def test_staff_requires_explicit_scope_and_removal_does_not_revive_it(library):
    client, _, _, _ = library
    ident = upload(client)
    sign_in(client, "staff-demo")
    assert client.get(f"/api/documents/{ident}").status_code == 404
    assert client.get("/api/documents/options").json()["units"] == []
    assert (
        client.post("/api/documents/staff-scopes", json={"unit_id": "council", "enabled": True}).status_code
        == 200
    )
    assert client.get(f"/api/documents/{ident}").status_code == 200
    assert (
        client.post("/api/documents/staff-scopes", json={"unit_id": "council", "enabled": False}).status_code
        == 200
    )
    assert client.get(f"/api/documents/{ident}").status_code == 404
    client.post("/api/documents/staff-scopes", json={"unit_id": "council", "enabled": True})
    client.post("/api/organizations/council/remove", json={"confirmation": "삭제하겠습니다"})
    client.post("/api/organizations", json={"name": "학과협의회"})
    assert client.get(f"/api/documents/{ident}").status_code == 404


def test_backup_restore_verifies_db_and_files_and_never_overwrites(library, tmp_path):
    client, path, _, _ = library
    ident = upload(client)
    backup = copy_snapshot(path, tmp_path / "backup")
    restored = copy_snapshot(backup, tmp_path / "restored")
    with TestClient(create_app(restored), headers=ORIGIN) as recovered:
        sign_in(recovered)
        assert recovered.get(f"/api/documents/{ident}/versions/1/download").content == b"synthetic v1"
    with pytest.raises(ValueError):
        copy_snapshot(path, tmp_path / "backup")
    next((path.parent / "library-files").iterdir()).write_bytes(b"corruption")
    assert client.get(f"/api/documents/{ident}/versions/1/download").status_code == 409
    with pytest.raises(Exception):
        copy_snapshot(path, tmp_path / "broken-backup")
    with sqlite3.connect(path) as original:
        assert original.execute("SELECT count(*) FROM documents").fetchone()[0] == 1


def test_search_classification_and_current_authorization_before_pagination(library):
    client, _, _, _ = library
    upload(client, metadata=metadata(title="alpha", academic_year=2025))
    upload(client, metadata=metadata(title="beta", academic_year=2026))
    response = client.get("/api/documents?academic_year=2025&folder=정기&event=가상&category=회의&limit=1")
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["title"] == "alpha"
    assert client.get("/api/documents?limit=1&offset=1").json()["total"] == 2
    sign_in(client, "student-new")
    assert client.get("/api/documents?limit=1").json() == {"items": [], "total": 0}


def test_role_revoked_during_upload_cannot_publish_and_removes_partial_file(library):
    client, path, _, _ = library
    session = prepare(client).json()["id"]

    def chunks():
        yield b"synthetic "
        with connect(path) as conn:
            conn.execute(
                "UPDATE assignments SET revoked_at=? WHERE user_id='chair'",
                (datetime.now(timezone.utc).isoformat(),),
            )
        yield b"v1"

    response = client.put(f"/api/documents/uploads/{session}/content", content=chunks())
    assert response.status_code == 403
    with connect(path) as conn:
        assert (
            conn.execute("SELECT state FROM document_uploads WHERE id=?", (session,)).fetchone()[0]
            == "REJECTED"
        )
        assert conn.execute("SELECT count(*) FROM documents").fetchone()[0] == 0
    assert not list((path.parent / "library-files").glob("*"))


@pytest.mark.parametrize("session_end", ["logout", "expired"])
def test_session_ends_during_stream_cannot_publish(library, session_end):
    client, path, clock, _ = library
    session = prepare(client).json()["id"]

    def chunks():
        yield b"synthetic "
        with connect(path) as conn:
            if session_end == "logout":
                conn.execute("DELETE FROM sessions WHERE user_id='chair'")
            else:
                conn.execute(
                    "UPDATE sessions SET expires_at=? WHERE user_id='chair'",
                    ((clock[0] - timedelta(seconds=1)).isoformat(),),
                )
        yield b"v1"

    assert client.put(f"/api/documents/uploads/{session}/content", content=chunks()).status_code == 403
    with connect(path) as conn:
        assert conn.execute("SELECT count(*) FROM documents").fetchone()[0] == 0
        assert (
            conn.execute("SELECT state FROM document_uploads WHERE id=?", (session,)).fetchone()[0]
            == "REJECTED"
        )
    assert not list((path.parent / "library-files").glob("*"))


def test_concurrent_version_sessions_preserve_original_and_only_one_revision(library):
    client, path, _, _ = library
    ident = upload(client)
    first = prepare(client, b"next", metadata=None, document_id=ident, expected_revision=1).json()["id"]
    second = prepare(client, b"next", metadata=None, document_id=ident, expected_revision=1).json()["id"]
    assert client.put(f"/api/documents/uploads/{first}/content", content=b"next").status_code == 200
    assert client.put(f"/api/documents/uploads/{second}/content", content=b"next").status_code == 409
    assert len(detail(client, ident)["versions"]) == 2
    assert len(list((path.parent / "library-files").iterdir())) == 2


def test_account_and_unit_removal_preserve_documents_for_successor(library):
    client, path, _, _ = library
    ident = upload(client)
    sign_in(client, "staff-demo")
    assert client.post("/api/users/chair/remove", json={"confirmation": "제거하겠습니다"}).status_code == 200
    client.post("/api/documents/staff-scopes", json={"unit_id": "council", "enabled": True})
    assert detail(client, ident)["title"] == "가상 회의록"
    assert client.post("/api/units/software/remove", json={"confirmed": True}).status_code == 200
    assert client.get(f"/api/documents/{ident}").status_code == 404
    assert (
        client.post(
            "/api/units", json={"parent_id": "council", "kind": "department", "name": "스마트소프트웨어학과"}
        ).status_code
        == 200
    )
    assert client.get(f"/api/documents/{ident}/versions/1/download").content == b"synthetic v1"
    with connect(path) as conn:
        assert conn.execute("SELECT count(*) FROM documents").fetchone()[0] == 1


def test_audit_failure_rolls_back_metadata_and_new_file(library, monkeypatch):
    from yeonieum.modules.documents import router

    client, path, _, app = library
    session = prepare(client).json()["id"]

    def fail(*args):
        raise RuntimeError("synthetic audit failure")

    monkeypatch.setattr(router, "audit", fail)
    with TestClient(app, headers=ORIGIN, raise_server_exceptions=False) as failing:
        sign_in(failing)
        assert (
            failing.put(f"/api/documents/uploads/{session}/content", content=b"synthetic v1").status_code
            == 500
        )
    with connect(path) as conn:
        assert conn.execute("SELECT count(*) FROM documents").fetchone()[0] == 0
        assert conn.execute("SELECT count(*) FROM document_versions").fetchone()[0] == 0
    assert not list((path.parent / "library-files").glob("*"))


def test_reader_cannot_mutate_or_choose_another_department_audience(library):
    client, _, _, _ = library
    ident = upload(client, metadata=metadata(audience="department:software"))
    sign_in(client, "student-vice")
    assert detail(client, ident)["can_manage"] is False
    assert client.post(f"/api/documents/{ident}/trash", json={"expected_revision": 1}).status_code == 404
    assert prepare(client, metadata=metadata(audience="department:mechanical")).status_code == 403
    assert (
        client.post("/api/documents/staff-scopes", json={"unit_id": "council", "enabled": True}).status_code
        == 403
    )


def create_folder(client, **changes):
    data = {
        "org_id": "council",
        "academic_year": 2026,
        "audience": "organization",
        "name": "가상 폴더",
        **changes,
    }
    response = client.post("/api/documents/folders", json=data)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_personal_file_and_folder_are_owner_only_even_for_leader_and_teacher(library):
    client, path, _, _ = library
    sign_in(client, "student-vice")
    folder = create_folder(client, audience="private", academic_year=2018, name="private folder secret")
    ident = upload(
        client,
        metadata=metadata(
            audience="private", folder_id=folder, academic_year=2018, title="private title secret"
        ),
    )
    assert detail(client, ident)["can_manage"]
    for name in ("student-chair", "student-rep", "staff-demo", "student-other"):
        sign_in(client, name)
        if name == "staff-demo":
            client.post("/api/documents/staff-scopes", json={"unit_id": "council", "enabled": True})
        assert client.get("/api/documents?q=private").json() == {"items": [], "total": 0}
        assert 2018 not in client.get("/api/documents/options").json()["years"]
        assert (
            client.get("/api/documents/folders?org_id=council&academic_year=2018&audience=private").json()
            == []
        )
        assert client.get(f"/api/documents?folder_id={folder}").status_code == 404
        assert client.get(f"/api/documents/{ident}").status_code == 404
        assert client.get(f"/api/documents/{ident}/versions/1/download").status_code == 404
        assert client.post(f"/api/documents/{ident}/trash", json={"expected_revision": 1}).status_code == 404
    sign_in(client, "student-vice")
    row = detail(client, ident)
    assert (
        client.post(
            f"/api/documents/{ident}/metadata",
            json={
                "metadata": metadata(
                    audience="private", folder_id=folder, academic_year=2018, title="updated private secret"
                ),
                "expected_revision": row["revision"],
            },
        ).status_code
        == 200
    )
    with connect(path) as conn:
        logs = str([r[0] for r in conn.execute("SELECT detail FROM audit")])
        assert "private folder secret" not in logs and "updated private secret" not in logs


def test_organization_share_is_explicit_and_revoked_roles_cannot_read(library):
    client, _, _, _ = library
    legacy = upload(client)
    shared = upload(client, metadata=metadata(audience="organization"))
    sign_in(client, "student-rep")
    assert client.get(f"/api/documents/{legacy}").status_code == 404
    assert detail(client, shared)["can_manage"] is False
    assert client.get(f"/api/documents/{shared}/versions/1/download").status_code == 200
    sign_in(client, "student-other")
    assert client.get(f"/api/documents/{shared}").status_code == 404
    sign_in(client, "staff-demo")
    assert client.get(f"/api/documents/{shared}").status_code == 404
    client.post("/api/documents/staff-scopes", json={"unit_id": "council", "enabled": True})
    assert detail(client, shared)
    client.post("/api/assignments/rep-role/revoke", json={"reason": "가상 종료"})
    sign_in(client, "student-rep")
    assert client.get(f"/api/documents/{shared}/versions/1/download").status_code == 404


def test_nested_folder_inherits_year_org_visibility_and_preserves_files(library):
    client, _, _, app = library
    parent = create_folder(client)
    child = create_folder(client, parent_id=parent, name="하위 폴더")
    ident = upload(client, metadata=metadata(audience="organization", folder_id=child))
    assert client.get(f"/api/documents?folder_id={parent}").json()["total"] == 0
    assert client.get(f"/api/documents?folder_id={child}").json()["items"][0]["id"] == ident
    assert client.get("/api/documents?folder_id=root").json()["total"] == 0
    for change in ({"academic_year": 2025}, {"audience": "private"}, {"org_id": "student-council"}):
        response = client.post(
            "/api/documents/folders",
            json={
                "org_id": "council",
                "academic_year": 2026,
                "audience": "organization",
                "name": "invalid",
                "parent_id": parent,
                **change,
            },
        )
        assert response.status_code in {403, 404, 422}
    assert prepare(client, metadata=metadata(audience="private", folder_id=child)).status_code == 422
    assert (
        prepare(
            client, metadata=metadata(audience="organization", folder_id=child, academic_year=2025)
        ).status_code
        == 422
    )
    with TestClient(app, headers=ORIGIN) as reopened:
        sign_in(reopened)
        folders = reopened.get(
            "/api/documents/folders?org_id=council&academic_year=2026&audience=organization"
        ).json()
        assert {r["id"] for r in folders} == {parent, child}
        assert detail(reopened, ident)["folder_id"] == child


def test_managers_move_shared_files_atomically_without_changing_versions_or_audience(library, monkeypatch):
    client, path, _, _ = library
    parent = create_folder(client)
    child = create_folder(client, parent_id=parent, name="하위 폴더")
    wrong_year = create_folder(client, academic_year=2025)
    sign_in(client, "student-vice")
    source = upload(client, metadata=metadata(audience="organization"))
    personal = upload(client, metadata=metadata(audience="private"))
    endpoint = f"/api/documents/{source}/move"
    assert detail(client, source)["can_manage"] and not detail(client, source)["can_move"]
    assert client.post(endpoint, json={"folder_id": child, "expected_revision": 1}).status_code == 403
    sign_in(client, "student-rep")
    assert not detail(client, source)["can_move"]
    assert client.post(endpoint, json={"folder_id": child, "expected_revision": 1}).status_code == 404

    sign_in(client, "student-chair")
    assert detail(client, source)["can_move"]
    before = detail(client, source)
    assert client.post(endpoint, json={"folder_id": wrong_year, "expected_revision": 1}).status_code == 422
    private_folder = create_folder(client, audience="private")
    assert (
        client.post(endpoint, json={"folder_id": private_folder, "expected_revision": 1}).status_code == 422
    )
    assert (
        client.post(
            f"/api/documents/{personal}/move", json={"folder_id": private_folder, "expected_revision": 1}
        ).status_code
        == 404
    )
    legacy = upload(client)
    assert not detail(client, legacy)["can_move"]
    assert (
        client.post(
            f"/api/documents/{legacy}/move", json={"folder_id": child, "expected_revision": 1}
        ).status_code
        == 403
    )
    assert detail(client, source) == before

    sign_in(client, "staff-demo")
    assert client.post(endpoint, json={"folder_id": child, "expected_revision": 1}).status_code == 404
    for org in ("council", "student"):
        response = client.post("/api/documents/staff-scopes", json={"unit_id": org, "enabled": True})
        assert response.is_success
    wrong_org = create_folder(client, org_id="student")
    assert client.post(endpoint, json={"folder_id": wrong_org, "expected_revision": 1}).status_code == 422
    assert client.post(endpoint, json={"folder_id": child, "expected_revision": 1}).status_code == 200
    assert client.post(endpoint, json={"folder_id": child, "expected_revision": 1}).status_code == 200
    assert client.post(endpoint, json={"folder_id": None, "expected_revision": 1}).status_code == 409
    assert detail(client, source)["folder_id"] == child
    assert client.post(endpoint, json={"folder_id": parent, "expected_revision": 2}).status_code == 200
    assert client.post(endpoint, json={"folder_id": None, "expected_revision": 3}).status_code == 200
    after = detail(client, source)
    assert after["revision"] == 4 and after["folder_id"] is None
    for key in ("audience", "versions", "current_version", "academic_year", "unit_id", "created_by"):
        assert after[key] == before[key]
    assert client.get(f"/api/documents/{source}/versions/1/download").content == b"synthetic v1"
    with connect(path) as conn:
        assert conn.execute("SELECT count(*) FROM audit WHERE action='document.moved'").fetchone()[0] == 3

    from yeonieum.modules.documents import router

    def fail_audit(*args):
        raise RuntimeError("synthetic audit failure")

    with monkeypatch.context() as patch:
        patch.setattr(router, "audit", fail_audit)
        with pytest.raises(RuntimeError, match="synthetic audit failure"):
            client.post(endpoint, json={"folder_id": child, "expected_revision": 4})
        assert detail(client, source) == after

    assert client.post(f"/api/documents/{source}/trash", json={"expected_revision": 4}).status_code == 200
    assert not detail(client, source)["can_move"]
    assert client.post(endpoint, json={"folder_id": child, "expected_revision": 5}).status_code == 404


def test_private_folder_ids_cannot_be_reused_and_duplicate_names_are_per_owner(library):
    client, _, _, _ = library
    own = create_folder(client, audience="private")
    sign_in(client, "student-vice")
    create_folder(client, audience="private")
    assert prepare(client, metadata=metadata(audience="private", folder_id=own)).status_code == 404
    assert (
        client.post(
            "/api/documents/folders",
            json={
                "org_id": "council",
                "academic_year": 2026,
                "audience": "private",
                "name": "child",
                "parent_id": own,
            },
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/api/documents/folders",
            json={"org_id": "council", "academic_year": 2026, "audience": "private", "name": "가상 폴더"},
        ).status_code
        == 409
    )
    for name in ("../folder", " ", "..", "a\\b", "a\u0000b"):
        assert (
            client.post(
                "/api/documents/folders",
                json={"org_id": "council", "academic_year": 2026, "audience": "private", "name": name},
            ).status_code
            == 422
        )


def test_owner_can_explicitly_share_personal_file_and_manager_cannot_take_it_private(library):
    client, _, _, _ = library
    sign_in(client, "student-vice")
    ident = upload(client, metadata=metadata(audience="private"))
    assert (
        client.post(
            f"/api/documents/{ident}/metadata",
            json={"metadata": metadata(audience="organization"), "expected_revision": 1},
        ).status_code
        == 200
    )
    sign_in(client)
    assert detail(client, ident)["can_manage"]
    assert (
        client.post(
            f"/api/documents/{ident}/metadata",
            json={"metadata": metadata(audience="private"), "expected_revision": 2},
        ).status_code
        == 403
    )


def test_folder_failure_is_atomic_and_legacy_database_gains_only_nullable_location(library, monkeypatch):
    from yeonieum.modules.documents import folders

    client, path, _, app = library
    ident = upload(client)

    def fail(*args):
        raise RuntimeError("synthetic failure")

    monkeypatch.setattr(folders, "audit", fail)
    with TestClient(app, headers=ORIGIN, raise_server_exceptions=False) as failing:
        sign_in(failing)
        assert (
            failing.post(
                "/api/documents/folders",
                json={
                    "org_id": "council",
                    "academic_year": 2026,
                    "audience": "organization",
                    "name": "rollback",
                },
            ).status_code
            == 500
        )
    with connect(path) as conn:
        assert conn.execute("SELECT count(*) FROM document_folders").fetchone()[0] == 0
        conn.execute("ALTER TABLE documents DROP COLUMN folder_id")
    with connect(path) as conn:
        row = conn.execute("SELECT * FROM documents WHERE id=?", (ident,)).fetchone()
        assert row["folder_id"] is None and row["audience"] == "unit"
        assert conn.execute("SELECT count(*) FROM document_versions").fetchone()[0] == 1
    assert client.get(f"/api/documents/{ident}/versions/1/download").content == b"synthetic v1"


def test_file_type_sort_and_personal_filters_count_only_permitted_files(library):
    client, _, _, _ = library
    upload(
        client,
        content=b"%PDF-1.7\nsynthetic",
        filename="sample.pdf",
        metadata=metadata(title="B", audience="organization"),
    )
    upload(client, metadata=metadata(title="A", audience="organization"))
    upload(client, metadata=metadata(title="secret", audience="private"))
    sign_in(client, "student-vice")
    assert client.get("/api/documents?audience=private").json()["total"] == 0
    assert client.get("/api/documents?file_type=pdf").json()["total"] == 1
    assert [r["title"] for r in client.get("/api/documents?sort=name&descending=false").json()["items"]] == [
        "A",
        "B",
    ]
