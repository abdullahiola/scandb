import io

from fastapi import APIRouter, UploadFile, File
from fastapi.responses import JSONResponse
from PIL import Image
import pytesseract

from app.services.ocr import preprocess_image, pdf_to_image
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

        data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
        raw_text = pytesseract.image_to_string(img)

        confidences = [
            int(c) for c, t in zip(data["conf"], data["text"])
            if int(c) > 0 and t.strip()
        ]
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0

        return {
            "raw_text": raw_text,
            "confidence": round(avg_confidence, 1),
            "fields": extract_fields_generic(raw_text),
            "method": "regex",
            "word_count": len([t for t in data["text"] if t.strip()]),
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

        # --- Dual-pass OCR ---
        # Pass 1: Raw image (captures headers/ref numbers that preprocessing destroys)
        raw_text_pass1 = pytesseract.image_to_string(img)

        # Pass 2: Preprocessed image (better for body text, handwriting)
        processed = preprocess_image(img)
        custom_config = r'--psm 6 --oem 3'
        raw_text_pass2 = pytesseract.image_to_string(processed, config=custom_config)
        data = pytesseract.image_to_data(processed, output_type=pytesseract.Output.DICT, config=custom_config)

        # Merge: use pass2 as primary, but prepend any header lines from pass1
        # that were lost in preprocessing (e.g., Ref numbers)
        import re
        header_lines = []
        for line in raw_text_pass1.split("\n")[:5]:
            line = line.strip()
            if line and re.search(r'(?:Ref|HR[&8]D|UI/|PF/)', line, re.IGNORECASE):
                # Check if this line already exists in pass2
                if line not in raw_text_pass2:
                    header_lines.append(line)

        if header_lines:
            raw_text = "\n".join(header_lines) + "\n" + raw_text_pass2
        else:
            raw_text = raw_text_pass2

        confidences = [
            int(c) for c, t in zip(data["conf"], data["text"])
            if int(c) > 0 and t.strip()
        ]
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0

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
            "confidence": round(avg_confidence, 1),
            "document_type": doc_info["type"],
            "document_label": doc_info["label"],
            "type_confidence": doc_info["confidence"],
            "is_form": doc_info["is_form"],
            "fields": extracted_fields,
            "expected_fields": DOCUMENT_TYPES.get(doc_info["type"], {}).get("fields", []),
            "method": "regex",
            "word_count": len([t for t in data["text"] if t.strip()]),
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
