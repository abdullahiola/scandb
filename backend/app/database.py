import os
import sqlite3

# =============================================
# DATABASE CONFIGURATION
# =============================================

DB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DB_PATH = os.path.join(DB_DIR, "scandb.db")


def get_db():
    """Get a new database connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    """Create tables if they don't exist."""
    os.makedirs(DB_DIR, exist_ok=True)
    conn = get_db()
    c = conn.cursor()

    c.execute("""
        CREATE TABLE IF NOT EXISTS staff (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            department TEXT DEFAULT '',
            staff_id TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS staff_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            staff_id INTEGER NOT NULL,
            document_type TEXT DEFAULT 'unknown',
            document_label TEXT DEFAULT '',
            file_name TEXT DEFAULT 'scan',
            file_path TEXT DEFAULT '',
            raw_text TEXT DEFAULT '',
            extracted_data TEXT DEFAULT '{}',
            full_content TEXT DEFAULT '',
            confidence REAL DEFAULT 0,
            is_form INTEGER DEFAULT 0,
            status TEXT DEFAULT 'pending',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
        )
    """)

    conn.commit()
    conn.close()


def row_to_dict(row):
    """Convert a sqlite3.Row to a dict with camelCase keys."""
    if row is None:
        return None
    d = dict(row)
    mapping = {
        "staff_id": "staffId",
        "created_at": "createdAt",
        "updated_at": "updatedAt",
        "document_type": "documentType",
        "document_label": "documentLabel",
        "file_name": "fileName",
        "file_path": "filePath",
        "raw_text": "rawText",
        "extracted_data": "extractedData",
        "full_content": "fullContent",
        "is_form": "isForm",
    }
    result = {}
    for k, v in d.items():
        key = mapping.get(k, k)
        if k == "is_form":
            v = bool(v)
        result[key] = v
    return result


def staff_with_documents(staff_row, conn):
    """Build a staff dict with its documents list."""
    staff = row_to_dict(staff_row)
    if staff is None:
        return None
    c = conn.cursor()
    c.execute(
        "SELECT * FROM staff_documents WHERE staff_id = ? ORDER BY created_at DESC",
        (staff["id"],),
    )
    staff["documents"] = [row_to_dict(r) for r in c.fetchall()]
    return staff
