import io

from fastapi import APIRouter, UploadFile, File
from fastapi.responses import JSONResponse
from PIL import Image

from app.services.ocr import run_ocr, pdf_to_image
from app.services.jobs import start_job, get_job, resize_if_needed
from app.services.classifier import (
    identify_document_type, extract_fields_for_type, DOCUMENT_TYPES,
)
from app.utils.fields import clean_field_value, extract_fields_generic

router = APIRouter()

# Max file size: 100MB
MAX_FILE_SIZE = 100 * 1024 * 1024
# Files under this size are processed inline (no job queue)
INLINE_THRESHOLD = 5 * 1024 * 1024  # 5MB


@router.post("/scan")
async def scan_document_legacy(file: UploadFile = File(...)):
    """Legacy endpoint — backwards compatible, always inline."""
    contents = await file.read()
    filename = file.filename or "unknown"

    try:
        if filename.lower().endswith(".pdf") or file.content_type == "application/pdf":
            img = pdf_to_image(contents)
        else:
            img = Image.open(io.BytesIO(contents))

        if img.mode != "RGB":
            img = img.convert("RGB")

        img = resize_if_needed(img)

        ocr = run_ocr(img)

        return {
            "raw_text": ocr["raw_text"],
            "confidence": ocr["confidence"],
            "fields": extract_fields_generic(ocr["raw_text"]),
            "method": "regex",
            "word_count": ocr["word_count"],
        }
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": f"Failed to process document: {str(e)}"})


@router.post("/scan-document")
async def scan_document(file: UploadFile = File(...)):
    """
    Smart scan endpoint.
    - Small files (< 5MB): processed inline, returns result immediately
    - Large files (>= 5MB): starts background job, returns job_id to poll
    """
    contents = await file.read()
    filename = file.filename or "unknown"

    if len(contents) > MAX_FILE_SIZE:
        return JSONResponse(
            status_code=413,
            content={"error": f"File too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)}MB."},
        )

    # Large files → background job
    if len(contents) >= INLINE_THRESHOLD:
        job = start_job(contents, filename)
        return {
            "job_id": job.id,
            "status": "processing",
            "message": f"File queued for processing ({len(contents) / (1024*1024):.1f}MB)",
        }

    # Small files → inline processing
    try:
        is_pdf = filename.lower().endswith(".pdf") or (file.content_type or "") == "application/pdf"

        if is_pdf:
            img = pdf_to_image(contents)
        else:
            img = Image.open(io.BytesIO(contents))

        if img.mode != "RGB":
            img = img.convert("RGB")

        img = resize_if_needed(img)

        ocr = run_ocr(img)
        raw_text = ocr["raw_text"]

        doc_info = identify_document_type(raw_text)
        extracted_fields = extract_fields_for_type(raw_text, doc_info["type"])
        extracted_fields = {
            k: clean_field_value(str(v))
            for k, v in extracted_fields.items()
            if v and str(v).strip()
        }
        extracted_fields = {k: v for k, v in extracted_fields.items() if v}

        return {
            "raw_text": raw_text,
            "confidence": ocr["confidence"],
            "document_type": doc_info["type"],
            "document_label": doc_info["label"],
            "type_confidence": doc_info["confidence"],
            "is_form": doc_info["is_form"],
            "fields": extracted_fields,
            "expected_fields": DOCUMENT_TYPES.get(doc_info["type"], {}).get("fields", []),
            "method": "regex",
            "word_count": ocr["word_count"],
            "page_count": 1,
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"error": f"Failed to process document: {str(e)}"})


@router.get("/jobs/{job_id}")
async def get_job_status(job_id: str):
    """Poll for job progress and results."""
    job = get_job(job_id)
    if not job:
        return JSONResponse(status_code=404, content={"error": "Job not found"})

    response = {
        "job_id": job.id,
        "status": job.status,
        "total_pages": job.total_pages,
        "pages_done": job.pages_done,
        "current_step": job.current_step,
    }

    if job.status == "done" and job.result:
        response["result"] = job.result
    elif job.status == "error":
        response["error"] = job.error

    return response
