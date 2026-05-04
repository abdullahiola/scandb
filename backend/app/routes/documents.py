import json

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.database import get_db, row_to_dict

router = APIRouter()


@router.patch("/staff/{staff_id}/documents/{doc_id}")
async def update_document(staff_id: int, doc_id: int, req: dict):
    """Update document status or extractedData."""
    conn = get_db()
    try:
        updates = []
        params = []
        if "status" in req:
            updates.append("status = ?")
            params.append(req["status"])
        if "extractedData" in req:
            val = req["extractedData"]
            if isinstance(val, dict):
                val = json.dumps(val)
            updates.append("extracted_data = ?")
            params.append(val)

        if not updates:
            return JSONResponse(status_code=400, content={"error": "No fields to update"})

        updates.append("updated_at = datetime('now')")
        params.append(doc_id)

        c = conn.cursor()
        c.execute(f"UPDATE staff_documents SET {', '.join(updates)} WHERE id = ?", params)
        conn.commit()

        if c.rowcount == 0:
            return JSONResponse(status_code=404, content={"error": "Document not found"})

        c.execute("SELECT * FROM staff_documents WHERE id = ?", (doc_id,))
        return {"document": row_to_dict(c.fetchone())}
    finally:
        conn.close()


@router.delete("/staff/{staff_id}/documents/{doc_id}")
async def delete_document(staff_id: int, doc_id: int):
    """Delete a single document."""
    conn = get_db()
    try:
        c = conn.cursor()
        c.execute("DELETE FROM staff_documents WHERE id = ?", (doc_id,))
        conn.commit()
        if c.rowcount == 0:
            return JSONResponse(status_code=404, content={"error": "Document not found"})
        return {"success": True}
    finally:
        conn.close()
