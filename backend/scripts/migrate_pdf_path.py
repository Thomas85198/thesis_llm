"""One-shot migration: convert absolute pdf_path entries to basename-only.

Background: before feat/openai-deploy, papers.pdf_path stored a full absolute
path. That broke when the project folder was renamed or moved (see the 16/15
incident, the Docker volume move, etc). Going forward we store only the
basename and resolve with UPLOAD_DIR at read time.

This script is idempotent — run multiple times safely. It only touches rows
whose pdf_path is currently absolute; rows already stored as basename are left
alone.

Run:
    cd backend
    .venv/bin/python3 -m scripts.migrate_pdf_path           # dry-run (default)
    .venv/bin/python3 -m scripts.migrate_pdf_path --apply   # actually write
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Add backend/ to sys.path when running as script.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import db  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--apply", action="store_true", help="actually write (default: dry-run)"
    )
    args = parser.parse_args()

    with db.connect() as conn:
        rows = conn.execute(
            "SELECT paper_id, pdf_path FROM papers WHERE pdf_path IS NOT NULL"
        ).fetchall()

        to_update: list[tuple[str, str]] = []
        for r in rows:
            pid, pp = r["paper_id"], r["pdf_path"]
            p = Path(pp)
            if p.is_absolute():
                new = p.name  # basename
                to_update.append((pid, new))
                print(f"  {pid}: {pp}  →  {new}")

        print(f"\n{len(to_update)} rows would be updated (of {len(rows)} total).")

        if not args.apply:
            print("Dry-run. Re-run with --apply to commit.")
            return 0

        if not to_update:
            print("Nothing to do.")
            return 0

        for pid, new in to_update:
            conn.execute(
                "UPDATE papers SET pdf_path=? WHERE paper_id=?", (new, pid)
            )
        print(f"\nApplied. {len(to_update)} rows updated.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
