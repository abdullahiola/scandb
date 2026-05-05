"""
Batch processing system for scanning multiple documents at once.
Manages a pool of OCR workers and auto-groups results by staff name.
"""

import uuid
import threading
import io
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any

from PIL import Image
import pytesseract

from app.services.ocr import preprocess_image, pdf_to_images
from app.services.classifier import identify_document_type, extract_fields_for_type, DOCUMENT_TYPES
from app.utils.fields import clean_field_value


MAX_DIMENSION = 2000
MAX_WORKERS = 4


def _resize_if_needed(img: Image.Image) -> Image.Image:
    w, h = img.size
    if max(w, h) > MAX_DIMENSION:
        ratio = MAX_DIMENSION / max(w, h)
        img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
    return img


@dataclass
class BatchItem:
    """A single document within a batch."""
    index: int
    source_name: str = ""       # original filename or "page_N"
    status: str = "queued"       # queued | processing | done | error
    error: Optional[str] = None

    # Results (populated when done)
    document_type: str = ""
    document_label: str = ""
    type_confidence: float = 0.0
    is_form: bool = False
    fields: Dict[str, str] = field(default_factory=dict)
    expected_fields: List[str] = field(default_factory=list)
    raw_text: str = ""
    confidence: float = 0.0
    word_count: int = 0
    staff_group: str = ""        # extracted name for grouping


@dataclass
class BatchJob:
    """Tracks a batch of documents being processed."""
    id: str
    status: str = "queued"       # queued | processing | done | error
    total_items: int = 0
    completed_items: int = 0
    current_step: str = ""
    items: List[BatchItem] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    error: Optional[str] = None


# Global batch job store
_batch_jobs: Dict[str, BatchJob] = {}
_batch_lock = threading.Lock()
BATCH_TTL_SECONDS = 3600  # 1 hour


def create_batch_job() -> BatchJob:
    """Create a new batch job."""
    job = BatchJob(id=str(uuid.uuid4()))
    with _batch_lock:
        # Clean old jobs
        cutoff = time.time() - BATCH_TTL_SECONDS
        stale = [k for k, v in _batch_jobs.items() if v.created_at < cutoff]
        for k in stale:
            del _batch_jobs[k]
        _batch_jobs[job.id] = job
    return job


def get_batch_job(job_id: str) -> Optional[BatchJob]:
    """Get a batch job by ID."""
    with _batch_lock:
        return _batch_jobs.get(job_id)


def _process_single_item(item: BatchItem, img: Image.Image) -> None:
    """Process a single image through OCR + classification."""
    try:
        item.status = "processing"

        img = _resize_if_needed(img)
        if img.mode != "RGB":
            img = img.convert("RGB")

        custom_config = r'--psm 6 --oem 3'

        # Pass 1: Raw image captures headers/ref numbers preprocessing destroys
        raw_pass1 = pytesseract.image_to_string(img)

        # Pass 2: Preprocessed image — use image_to_data only (it contains the text)
        processed = preprocess_image(img)
        data = pytesseract.image_to_data(
            processed, output_type=pytesseract.Output.DICT, config=custom_config
        )

        # Reconstruct text from data output (avoids redundant image_to_string call)
        raw_pass2 = "\n".join(
            " ".join(
                data["text"][j]
                for j in range(len(data["text"]))
                if data["block_num"][j] == block and data["text"][j].strip()
            )
            for block in sorted(set(data["block_num"]))
            if any(data["text"][j].strip() for j in range(len(data["text"])) if data["block_num"][j] == block)
        )

        # Merge header lines from raw pass
        header_lines = []
        for line in raw_pass1.split("\n")[:5]:
            line = line.strip()
            if line and re.search(r'(?:Ref|HR[&D]|UI/|PF/)', line, re.IGNORECASE):
                if line not in raw_pass2:
                    header_lines.append(line)

        if header_lines:
            raw_text = "\n".join(header_lines) + "\n" + raw_pass2
        else:
            raw_text = raw_pass2

        # Confidence
        confidences = [
            int(c) for c, t in zip(data["conf"], data["text"])
            if int(c) > 0 and t.strip()
        ]
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0

        # Classify and extract
        doc_info = identify_document_type(raw_text)
        extracted_fields = extract_fields_for_type(raw_text, doc_info["type"])
        extracted_fields = {
            k: clean_field_value(str(v))
            for k, v in extracted_fields.items()
            if v and str(v).strip()
        }
        extracted_fields = {k: v for k, v in extracted_fields.items() if v}

        # Populate item
        item.document_type = doc_info["type"]
        item.document_label = doc_info["label"]
        item.type_confidence = doc_info["confidence"]
        item.is_form = doc_info["is_form"]
        item.fields = extracted_fields
        item.expected_fields = DOCUMENT_TYPES.get(doc_info["type"], {}).get("fields", [])
        item.raw_text = raw_text
        item.confidence = round(avg_confidence, 1)
        item.word_count = len([t for t in data["text"] if t.strip()])

        # Extract staff name for grouping
        name = extracted_fields.get("name", "").strip()
        if name:
            item.staff_group = _normalize_name(name)
        else:
            item.staff_group = ""

        item.status = "done"

    except Exception as e:
        item.status = "error"
        item.error = str(e)


def _normalize_name(name: str) -> str:
    """Normalize a name for grouping (handles OCR variations)."""
    # Remove common OCR artifacts and normalize
    name = re.sub(r'[^\w\s.-]', '', name)
    name = re.sub(r'\s+', ' ', name).strip()
    # Title case for consistency
    return name.title()


def _run_batch(job: BatchJob, images: List[tuple]) -> None:
    """
    Process all images in a batch using a thread pool.
    images: list of (index, source_name, PIL.Image)
    """
    try:
        job.status = "processing"
        job.total_items = len(images)
        job.current_step = f"Processing {len(images)} documents"

        # Create batch items
        for idx, source_name, _ in images:
            item = BatchItem(index=idx, source_name=source_name)
            job.items.append(item)

        # Process with thread pool
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            futures = {}
            for (idx, source_name, img), item in zip(images, job.items):
                future = pool.submit(_process_single_item, item, img)
                futures[future] = item

            for future in as_completed(futures):
                item = futures[future]
                try:
                    future.result()
                except Exception as e:
                    item.status = "error"
                    item.error = str(e)

                job.completed_items = sum(
                    1 for i in job.items if i.status in ("done", "error")
                )
                job.current_step = f"Processed {job.completed_items}/{job.total_items}"

        job.status = "done"
        job.current_step = "Complete"

    except Exception as e:
        job.status = "error"
        job.error = str(e)
        job.current_step = "Failed"


def start_batch_from_pdf(job: BatchJob, pdf_bytes: bytes, filename: str) -> None:
    """Split a PDF into pages and process each as a batch item."""
    def _worker():
        try:
            job.current_step = "Splitting PDF into pages..."
            pages = pdf_to_images(pdf_bytes)
            images = [
                (i, f"{filename}_page_{i+1}", page)
                for i, page in enumerate(pages)
            ]
            _run_batch(job, images)
        except Exception as e:
            job.status = "error"
            job.error = f"Failed to split PDF: {str(e)}"

    thread = threading.Thread(target=_worker, daemon=True)
    thread.start()


def start_batch_from_images(job: BatchJob, image_list: List[tuple]) -> None:
    """
    Process a list of image files as a batch.
    image_list: [(filename, bytes), ...]
    """
    def _worker():
        try:
            job.current_step = "Loading images..."
            images = []
            for i, (filename, file_bytes) in enumerate(image_list):
                if filename.lower().endswith(".pdf"):
                    # Individual PDF — take first page
                    from app.services.ocr import pdf_to_image
                    img = pdf_to_image(file_bytes)
                else:
                    img = Image.open(io.BytesIO(file_bytes))
                if img.mode != "RGB":
                    img = img.convert("RGB")
                images.append((i, filename, img))
            _run_batch(job, images)
        except Exception as e:
            job.status = "error"
            job.error = f"Failed to load images: {str(e)}"

    thread = threading.Thread(target=_worker, daemon=True)
    thread.start()


def batch_job_to_dict(job: BatchJob) -> dict:
    """Serialize a batch job for API response."""
    items = []
    for item in job.items:
        d = {
            "index": item.index,
            "source_name": item.source_name,
            "status": item.status,
        }
        if item.status == "done":
            d.update({
                "document_type": item.document_type,
                "document_label": item.document_label,
                "type_confidence": item.type_confidence,
                "is_form": item.is_form,
                "fields": item.fields,
                "confidence": item.confidence,
                "word_count": item.word_count,
                "staff_group": item.staff_group,
            })
        elif item.status == "error":
            d["error"] = item.error
        items.append(d)

    # Group items by staff name
    groups: Dict[str, List[dict]] = {}
    unmatched = []
    for item in items:
        if item.get("status") == "done":
            group_key = item.get("staff_group", "")
            if group_key:
                groups.setdefault(group_key, []).append(item)
            else:
                unmatched.append(item)

    return {
        "batch_id": job.id,
        "status": job.status,
        "total_items": job.total_items,
        "completed_items": job.completed_items,
        "current_step": job.current_step,
        "items": items,
        "staff_groups": {
            name: {
                "name": name,
                "document_count": len(docs),
                "documents": docs,
            }
            for name, docs in sorted(groups.items())
        },
        "unmatched": unmatched,
        "error": job.error,
    }
