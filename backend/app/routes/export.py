import io
import os
import re
import json
import sqlite3
import tempfile
from datetime import datetime

from fastapi import APIRouter
from fastapi.responses import StreamingResponse, JSONResponse

from app.database import DB_PATH

router = APIRouter()


@router.post("/export")
async def export_db(
    file_name: str = "scan",
    raw_text: str = "",
    confidence: float = 0,
    fields: str = "{}",
):
    """Generate and return a SQLite .db file (legacy per-document export)."""
    parsed_fields = json.loads(fields) if isinstance(fields, str) else fields

    db_path = tempfile.mktemp(suffix=".db")
    conn = sqlite3.connect(db_path)
    c = conn.cursor()

    c.execute("""
        CREATE TABLE documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_name TEXT NOT NULL,
            raw_text TEXT,
            confidence REAL,
            scanned_at TEXT DEFAULT (datetime('now'))
        )
    """)

    c.execute("""
        CREATE TABLE extracted_fields (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            document_id INTEGER NOT NULL,
            field_name TEXT NOT NULL,
            field_value TEXT,
            FOREIGN KEY (document_id) REFERENCES documents(id)
        )
    """)

    c.execute(
        "INSERT INTO documents (file_name, raw_text, confidence) VALUES (?, ?, ?)",
        (file_name, raw_text, confidence),
    )

    for key, value in parsed_fields.items():
        if key and str(value).strip():
            c.execute(
                "INSERT INTO extracted_fields (document_id, field_name, field_value) VALUES (1, ?, ?)",
                (key, str(value)),
            )

    if parsed_fields:
        valid = {k: v for k, v in parsed_fields.items() if k.strip()}
        if valid:
            cols = ", ".join(
                f'"{re.sub(r"[^a-zA-Z0-9_]", "_", k).lower()}" TEXT' for k in valid
            )
            c.execute(
                f'CREATE TABLE data (id INTEGER PRIMARY KEY AUTOINCREMENT, file_name TEXT, {cols}, scanned_at TEXT DEFAULT (datetime(\'now\')))'
            )
            placeholders = ", ".join("?" for _ in valid)
            col_names = ", ".join(
                f'"{re.sub(r"[^a-zA-Z0-9_]", "_", k).lower()}"' for k in valid
            )
            c.execute(
                f"INSERT INTO data (file_name, {col_names}) VALUES (?, {placeholders})",
                [file_name] + list(valid.values()),
            )

    conn.commit()
    conn.close()

    with open(db_path, "rb") as f:
        db_bytes = f.read()
    os.unlink(db_path)

    return StreamingResponse(
        io.BytesIO(db_bytes),
        media_type="application/x-sqlite3",
        headers={
            "Content-Disposition": f'attachment; filename="scan_{int(datetime.now().timestamp())}.db"',
        },
    )


@router.get("/export-db")
async def export_full_db():
    """Download the full staff database as .db file."""
    if not os.path.exists(DB_PATH):
        return JSONResponse(status_code=404, content={"error": "Database not found"})

    with open(DB_PATH, "rb") as f:
        db_bytes = f.read()

    timestamp = datetime.now().strftime("%Y-%m-%d")
    return StreamingResponse(
        io.BytesIO(db_bytes),
        media_type="application/x-sqlite3",
        headers={
            "Content-Disposition": f'attachment; filename="scandb_staff_{timestamp}.db"',
        },
    )
