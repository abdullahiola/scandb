import json

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.database import get_db, row_to_dict, staff_with_documents

router = APIRouter()


@router.get("/staff")
async def list_staff():
    """List all staff with their documents."""
    conn = get_db()
    try:
        c = conn.cursor()
        c.execute("SELECT * FROM staff ORDER BY updated_at DESC")
        staff_list = [staff_with_documents(row, conn) for row in c.fetchall()]
        return {"staff": staff_list}
    finally:
        conn.close()


@router.post("/staff")
async def create_staff(req: dict):
    """Create or find staff, optionally save a document."""
    name = (req.get("name") or "").strip()
    if not name:
        return JSONResponse(status_code=400, content={"error": "Staff name is required"})

    department = (req.get("department") or "").strip()
    staff_id_val = (req.get("staffId") or "").strip()
    document = req.get("document")

    conn = get_db()
    try:
        c = conn.cursor()

        c.execute("SELECT * FROM staff WHERE LOWER(name) = LOWER(?)", (name,))
        staff_row = c.fetchone()

        if staff_row is None:
            c.execute(
                "INSERT INTO staff (name, department, staff_id) VALUES (?, ?, ?)",
                (name, department, staff_id_val),
            )
            conn.commit()
            staff_id = c.lastrowid
        else:
            staff_id = staff_row["id"]
            updates = []
            params = []
            if department and not staff_row["department"]:
                updates.append("department = ?")
                params.append(department)
            if staff_id_val and not staff_row["staff_id"]:
                updates.append("staff_id = ?")
                params.append(staff_id_val)
            if updates:
                updates.append("updated_at = datetime('now')")
                params.append(staff_id)
                c.execute(f"UPDATE staff SET {', '.join(updates)} WHERE id = ?", params)
                conn.commit()

        saved_doc = None
        if document:
            extracted = document.get("extractedData", {})
            if isinstance(extracted, dict):
                extracted = json.dumps(extracted)

            c.execute(
                """INSERT INTO staff_documents
                   (staff_id, document_type, document_label, file_name, file_path,
                    raw_text, extracted_data, full_content, confidence, is_form, status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    staff_id,
                    document.get("documentType", "unknown"),
                    document.get("documentLabel", ""),
                    document.get("fileName", "scan"),
                    document.get("filePath", ""),
                    document.get("rawText", ""),
                    extracted,
                    document.get("fullContent", ""),
                    document.get("confidence", 0),
                    1 if document.get("isForm") else 0,
                    "reviewed",
                ),
            )
            conn.commit()
            doc_id = c.lastrowid
            c.execute("SELECT * FROM staff_documents WHERE id = ?", (doc_id,))
            saved_doc = row_to_dict(c.fetchone())

        c.execute("UPDATE staff SET updated_at = datetime('now') WHERE id = ?", (staff_id,))
        conn.commit()

        c.execute("SELECT * FROM staff WHERE id = ?", (staff_id,))
        staff = staff_with_documents(c.fetchone(), conn)

        result = {"staff": staff}
        if saved_doc:
            result["savedDocument"] = saved_doc
        return result
    finally:
        conn.close()


@router.get("/staff/{staff_id}")
async def get_staff(staff_id: int):
    """Get a single staff with full document details."""
    conn = get_db()
    try:
        c = conn.cursor()
        c.execute("SELECT * FROM staff WHERE id = ?", (staff_id,))
        row = c.fetchone()
        if not row:
            return JSONResponse(status_code=404, content={"error": "Staff not found"})
        return {"staff": staff_with_documents(row, conn)}
    finally:
        conn.close()


@router.patch("/staff/{staff_id}")
async def update_staff(staff_id: int, req: dict):
    """Update staff name/department."""
    conn = get_db()
    try:
        updates = []
        params = []
        if "name" in req:
            updates.append("name = ?")
            params.append(req["name"].strip())
        if "department" in req:
            updates.append("department = ?")
            params.append(req["department"].strip())
        if "staffId" in req:
            updates.append("staff_id = ?")
            params.append(req["staffId"].strip())

        if not updates:
            return JSONResponse(status_code=400, content={"error": "No fields to update"})

        updates.append("updated_at = datetime('now')")
        params.append(staff_id)

        c = conn.cursor()
        c.execute(f"UPDATE staff SET {', '.join(updates)} WHERE id = ?", params)
        conn.commit()

        if c.rowcount == 0:
            return JSONResponse(status_code=404, content={"error": "Staff not found"})

        c.execute("SELECT * FROM staff WHERE id = ?", (staff_id,))
        return {"staff": staff_with_documents(c.fetchone(), conn)}
    finally:
        conn.close()


@router.delete("/staff/{staff_id}")
async def delete_staff(staff_id: int):
    """Delete staff and cascade documents."""
    conn = get_db()
    try:
        c = conn.cursor()
        c.execute("DELETE FROM staff WHERE id = ?", (staff_id,))
        conn.commit()
        if c.rowcount == 0:
            return JSONResponse(status_code=404, content={"error": "Staff not found"})
        return {"success": True}
    finally:
        conn.close()
