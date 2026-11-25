"""Offline local library backup/restore into a NEW destination; never replace a live DB."""

import argparse
import json
import shutil
import sqlite3
from pathlib import Path

from yeonieum.modules.documents.storage import FileStore


def copy_snapshot(database, destination):
    database, destination = Path(database).resolve(), Path(destination).resolve()
    if not database.is_file():
        raise ValueError("원본 DB를 찾을 수 없습니다.")
    if destination.exists():
        raise ValueError("기존 폴더에는 복사하지 않습니다. 새 대상 폴더를 지정해 주세요.")
    destination.mkdir(parents=True)
    target = destination / "prototype.sqlite3"
    source = sqlite3.connect(f"{database.as_uri()}?mode=ro", uri=True)
    source.row_factory = sqlite3.Row
    try:
        with sqlite3.connect(target) as saved:
            source.backup(saved)
        with sqlite3.connect(target) as saved:
            saved.row_factory = sqlite3.Row
            versions = saved.execute("SELECT * FROM document_versions").fetchall()
            has_evidence = saved.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='expense_evidence'"
            ).fetchone()
            evidence = saved.execute("SELECT * FROM expense_evidence").fetchall() if has_evidence else []
        store = FileStore(database.parent / f"{database.stem}-files")
        files = destination / "prototype-files"
        files.mkdir()
        for row in versions:
            path = store.verified(row)
            if not (files / row["storage_key"]).exists():
                shutil.copyfile(path, files / row["storage_key"])
        # Recheck the copied bytes too; a concurrent external file edit is an error.
        for row in versions:
            FileStore(files).verified(row)
        evidence_store = FileStore(database.parent / f"{database.stem}-evidence")
        evidence_files = destination / "prototype-evidence"
        evidence_files.mkdir()
        for row in evidence:
            path = evidence_store.verified(row)
            if not (evidence_files / row["storage_key"]).exists():
                shutil.copyfile(path, evidence_files / row["storage_key"])
        for row in evidence:
            FileStore(evidence_files).verified(row)
        (destination / "backup.json").write_text(
            json.dumps(
                {"format": 2, "versions": len(versions), "evidence": len(evidence), "database": target.name}
            ),
            encoding="utf-8",
        )
    finally:
        source.close()
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["backup", "restore"])
    parser.add_argument("--database", required=True, help="복사할 DB 또는 백업의 prototype.sqlite3")
    parser.add_argument("--destination", required=True, help="존재하지 않는 새 폴더")
    args = parser.parse_args()
    # Restore uses exactly the same verified snapshot copy, into a separate new directory.
    print(copy_snapshot(args.database, args.destination))


if __name__ == "__main__":
    main()
