"""
Batch scan API endpoints.
- POST /batch-scan       — upload multiple files or a multi-page PDF
- GET  /batch-jobs/{id}  — poll batch progress + partial results
- POST /batch-jobs/{id}/commit — bulk save all results to staff database
"""

import json

from fastapi import APIRouter, UploadFile, File
from fastapi.responses import JSONResponse
from typing import List

from app.services.batch import (
    create_batch_job,
    get_batch_job,
    start_batch_from_pdf,
    start_batch_from_images,
    batch_job_to_dict,
)
from app.database import get_db

router = APIRouter()

# Max total batch size: 500MB
MAX_BATCH_SIZE = 500 * 1024 * 1024


@router.post("/batch-scan")
async def batch_scan(files: List[UploadFile] = File(...)):
    """
    Upload multiple files for batch processing.

    If a single PDF is uploaded, it's split into pages (one item per page).
    If multiple files are uploaded, each file becomes one item.
    """
    if not files:
        return JSONResponse(status_code=400, content={"error": "No files provided"})

    # Read all file contents
    file_data = []
    total_size = 0
    for f in files:
        content = await f.read()
        total_size += len(content)
        if total_size > MAX_BATCH_SIZE:
            return JSONResponse(
                status_code=413,
                content={"error": f"Total upload exceeds {MAX_BATCH_SIZE // (1024*1024)}MB limit"},
            )
        file_data.append((f.filename or f"file_{len(file_data)}", content))

    job = create_batch_job()

    # Single PDF → split into pages
    if len(file_data) == 1 and file_data[0][0].lower().endswith(".pdf"):
        filename, pdf_bytes = file_data[0]
        start_batch_from_pdf(job, pdf_bytes, filename)
        return {
            "batch_id": job.id,
            "status": "processing",
            "message": f"PDF uploaded ({len(pdf_bytes) / (1024*1024):.1f}MB). Splitting into pages...",
            "mode": "pdf",
        }

    # Multiple files → process each
    start_batch_from_images(job, file_data)
    return {
        "batch_id": job.id,
        "status": "processing",
        "message": f"{len(file_data)} files queued for processing",
        "total_files": len(file_data),
        "mode": "multi",
    }


@router.get("/batch-jobs/{batch_id}")
async def get_batch_status(batch_id: str):
    """Poll batch processing progress and partial results."""
    job = get_batch_job(batch_id)
    if not job:
        return JSONResponse(status_code=404, content={"error": "Batch job not found"})
    return batch_job_to_dict(job)


@router.post("/batch-jobs/{batch_id}/commit")
async def commit_batch(batch_id: str, req: dict = None):
    """
    Bulk save all batch results to the staff database.

    Accepts optional overrides in the request body:
    {
        "corrections": {
            "0": {"name": "Corrected Name", "department": "Corrected Dept"},
            "5": {"name": "Another Fix"}
        }
    }
    """
    job = get_batch_job(batch_id)
    if not job:
        return JSONResponse(status_code=404, content={"error": "Batch job not found"})

    if job.status != "done":
        return JSONResponse(
            status_code=400,
            content={"error": f"Batch is still {job.status}. Wait for completion."},
        )

    corrections = (req or {}).get("corrections", {})

    conn = get_db()
    try:
        c = conn.cursor()
        saved_count = 0
        staff_created = 0
        staff_updated = 0
        errors = []

        # Cache staff lookups to avoid repeated queries for same name
        staff_cache: dict = {}

        for item in job.items:
            if item.status != "done":
                continue

            # Apply corrections if any
            idx_str = str(item.index)
            name = item.fields.get("name", "").strip()
            department = item.fields.get("department", "").strip()

            if idx_str in corrections:
                corr = corrections[idx_str]
                if "name" in corr:
                    name = corr["name"].strip()
                if "department" in corr:
                    department = corr["department"].strip()

            if not name:
                errors.append({
                    "index": item.index,
                    "source": item.source_name,
                    "error": "No staff name — skipped",
                })
                continue

            # Find or create staff (with cache)
            name_lower = name.lower()
            if name_lower in staff_cache:
                staff_id = staff_cache[name_lower]
            else:
                c.execute("SELECT id, department FROM staff WHERE LOWER(name) = LOWER(?)", (name,))
                staff_row = c.fetchone()

                if staff_row is None:
                    c.execute(
                        "INSERT INTO staff (name, department) VALUES (?, ?)",
                        (name, department),
                    )
                    staff_id = c.lastrowid
                    staff_created += 1
                else:
                    staff_id = staff_row["id"]
                    if department and not staff_row["department"]:
                        c.execute(
                            "UPDATE staff SET department = ?, updated_at = datetime('now') WHERE id = ?",
                            (department, staff_id),
                        )
                    staff_updated += 1

                staff_cache[name_lower] = staff_id

            # Save document
            extracted_json = json.dumps(item.fields)
            c.execute(
                """INSERT INTO staff_documents
                   (staff_id, document_type, document_label, file_name,
                    raw_text, extracted_data, confidence, is_form, status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    staff_id,
                    item.document_type,
                    item.document_label,
                    item.source_name,
                    item.raw_text,
                    extracted_json,
                    item.confidence,
                    1 if item.is_form else 0,
                    "reviewed",
                ),
            )
            saved_count += 1

        # Update timestamps for all affected staff in one pass
        for sid in set(staff_cache.values()):
            c.execute("UPDATE staff SET updated_at = datetime('now') WHERE id = ?", (sid,))

        # Single commit for entire batch
        conn.commit()

        return {
            "success": True,
            "saved_documents": saved_count,
            "staff_created": staff_created,
            "staff_updated": staff_updated,
            "errors": errors,
            "total_items": job.total_items,
        }

    except Exception as e:
        conn.rollback()
        return JSONResponse(
            status_code=500,
            content={"error": f"Failed to commit batch: {str(e)}"},
        )
    finally:
        conn.close()

