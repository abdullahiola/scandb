"""
Lightweight in-memory job queue for background OCR processing.
Jobs are stored in a dict keyed by UUID. A background thread processes
each page and updates progress. Frontend polls GET /jobs/{id} for status.
"""

import uuid
import threading
import io
import time
from dataclasses import dataclass, field
from typing import Dict, Optional, Any

from PIL import Image
import pytesseract

from app.services.ocr import preprocess_image, pdf_to_images
from app.services.classifier import identify_document_type, extract_fields_for_type, DOCUMENT_TYPES
from app.utils.fields import clean_field_value


MAX_DIMENSION = 2000


def resize_if_needed(img: Image.Image) -> Image.Image:
    w, h = img.size
    if max(w, h) > MAX_DIMENSION:
        ratio = MAX_DIMENSION / max(w, h)
        img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
    return img


@dataclass
class Job:
    id: str
    status: str = "queued"          # queued | processing | done | error
    total_pages: int = 0
    pages_done: int = 0
    current_step: str = ""
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)


# Global job store
_jobs: Dict[str, Job] = {}
_lock = threading.Lock()

# Auto-clean jobs older than 30 minutes
JOB_TTL_SECONDS = 1800


def create_job() -> Job:
    """Create a new job and return it."""
    job = Job(id=str(uuid.uuid4()))
    with _lock:
        # Clean old jobs
        cutoff = time.time() - JOB_TTL_SECONDS
        stale = [k for k, v in _jobs.items() if v.created_at < cutoff]
        for k in stale:
            del _jobs[k]
        _jobs[job.id] = job
    return job


def get_job(job_id: str) -> Optional[Job]:
    """Get a job by ID."""
    with _lock:
        return _jobs.get(job_id)


def process_job(job: Job, file_bytes: bytes, filename: str):
    """Process a scan job in a background thread."""
    try:
        job.status = "processing"
        job.current_step = "Reading file"

        is_pdf = filename.lower().endswith(".pdf")

        if is_pdf:
            job.current_step = "Converting PDF pages"
            pages = pdf_to_images(file_bytes)
        else:
            img = Image.open(io.BytesIO(file_bytes))
            if img.mode != "RGB":
                img = img.convert("RGB")
            pages = [img]

        job.total_pages = len(pages)
        job.current_step = f"Processing {len(pages)} page(s)"

        custom_config = r'--psm 6 --oem 3'
        all_text_parts = []
        all_confidences = []
        total_words = 0

        for i, page_img in enumerate(pages):
            job.pages_done = i
            job.current_step = f"OCR page {i + 1}/{len(pages)}"

            page_img = resize_if_needed(page_img)
            if page_img.mode != "RGB":
                page_img = page_img.convert("RGB")

            # Dual-pass for first page: raw pass captures headers/ref numbers
            # that preprocessing destroys
            import re as _re
            if i == 0:
                raw_pass1 = pytesseract.image_to_string(page_img)
            else:
                raw_pass1 = ""

            processed = preprocess_image(page_img)
            page_text = pytesseract.image_to_string(processed, config=custom_config)
            page_data = pytesseract.image_to_data(
                processed, output_type=pytesseract.Output.DICT, config=custom_config
            )

            # Merge header lines from raw pass into preprocessed result (first page only)
            if raw_pass1:
                header_lines = []
                for line in raw_pass1.split("\n")[:5]:
                    line = line.strip()
                    if line and _re.search(r'(?:Ref|HR[&8]D|UI/|PF/)', line, _re.IGNORECASE):
                        if line not in page_text:
                            header_lines.append(line)
                if header_lines:
                    page_text = "\n".join(header_lines) + "\n" + page_text

            all_text_parts.append(page_text)

            page_confs = [
                int(c) for c, t in zip(page_data["conf"], page_data["text"])
                if int(c) > 0 and t.strip()
            ]
            all_confidences.extend(page_confs)
            total_words += len([t for t in page_data["text"] if t.strip()])

        job.pages_done = len(pages)
        job.current_step = "Classifying document"

        # Combine all pages
        if len(all_text_parts) > 1:
            raw_text = "\n\n--- Page Break ---\n\n".join(all_text_parts)
        else:
            raw_text = all_text_parts[0] if all_text_parts else ""

        avg_confidence = sum(all_confidences) / len(all_confidences) if all_confidences else 0

        # Classify and extract fields
        job.current_step = "Extracting fields"
        doc_info = identify_document_type(raw_text)
        extracted_fields = extract_fields_for_type(raw_text, doc_info["type"])

        extracted_fields = {
            k: clean_field_value(str(v))
            for k, v in extracted_fields.items()
            if v and str(v).strip()
        }
        extracted_fields = {k: v for k, v in extracted_fields.items() if v}

        job.result = {
            "raw_text": raw_text,
            "confidence": round(avg_confidence, 1),
            "document_type": doc_info["type"],
            "document_label": doc_info["label"],
            "type_confidence": doc_info["confidence"],
            "is_form": doc_info["is_form"],
            "fields": extracted_fields,
            "expected_fields": DOCUMENT_TYPES.get(doc_info["type"], {}).get("fields", []),
            "method": "regex",
            "word_count": total_words,
            "page_count": len(pages),
        }

        job.status = "done"
        job.current_step = "Complete"

    except Exception as e:
        import traceback
        traceback.print_exc()
        job.status = "error"
        job.error = str(e)
        job.current_step = "Failed"


def start_job(file_bytes: bytes, filename: str) -> Job:
    """Create and start a background processing job."""
    job = create_job()
    thread = threading.Thread(
        target=process_job,
        args=(job, file_bytes, filename),
        daemon=True,
    )
    thread.start()
    return job
