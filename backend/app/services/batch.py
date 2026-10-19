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

from app.services.ocr import run_ocr, pdf_to_images
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

        ocr = run_ocr(img)
        raw_text = ocr["raw_text"]

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
        item.confidence = ocr["confidence"]
        item.word_count = ocr["word_count"]

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


def _run_batch_lazy(job: BatchJob, page_loader, total: int) -> None:
    """
    Process documents lazily — only load images as workers need them.
    page_loader: callable(index) -> (source_name, PIL.Image) or None
    total: total number of items
    """
    try:
        job.status = "processing"
        job.total_items = total
        job.current_step = f"Processing {total} documents"

        # Pre-create all items
        for i in range(total):
            job.items.append(BatchItem(index=i, source_name=f"page_{i+1}"))

        # Use a queue to feed images to workers lazily
        import queue
        work_queue: queue.Queue = queue.Queue(maxsize=MAX_WORKERS + 1)

        def _producer():
            """Load images one at a time and put into queue."""
            for i in range(total):
                try:
                    result = page_loader(i)
                    if result:
                        name, img = result
                        job.items[i].source_name = name
                        work_queue.put((i, img))
                    else:
                        job.items[i].status = "error"
                        job.items[i].error = "Failed to load"
                except Exception as e:
                    job.items[i].status = "error"
                    job.items[i].error = str(e)
            # Signal done
            for _ in range(MAX_WORKERS):
                work_queue.put(None)

        def _consumer():
            """Pull images from queue and process them."""
            while True:
                task = work_queue.get()
                if task is None:
                    break
                idx, img = task
                try:
                    _process_single_item(job.items[idx], img)
                except Exception as e:
                    job.items[idx].status = "error"
                    job.items[idx].error = str(e)
                finally:
                    del img  # Release memory immediately
                    job.completed_items = sum(
                        1 for it in job.items if it.status in ("done", "error")
                    )
                    job.current_step = f"Processed {job.completed_items}/{job.total_items}"

        # Start producer
        producer = threading.Thread(target=_producer, daemon=True)
        producer.start()

        # Start consumer workers
        consumers = []
        for _ in range(MAX_WORKERS):
            t = threading.Thread(target=_consumer, daemon=True)
            t.start()
            consumers.append(t)

        # Wait for all to finish
        producer.join()
        for t in consumers:
            t.join()

        job.status = "done"
        job.current_step = "Complete"

    except Exception as e:
        job.status = "error"
        job.error = str(e)
        job.current_step = "Failed"


def start_batch_from_pdf(job: BatchJob, pdf_bytes: bytes, filename: str) -> None:
    """Split a PDF into pages and process each lazily (one page at a time)."""
    def _worker():
        try:
            import fitz
            job.current_step = "Reading PDF..."
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            total = len(doc)
            mat = fitz.Matrix(200 / 72, 200 / 72)  # 200 DPI

            def load_page(i: int):
                """Convert a single PDF page to PIL — only when needed."""
                page = doc[i]
                pix = page.get_pixmap(matrix=mat)
                img = Image.open(io.BytesIO(pix.tobytes("png")))
                if img.mode != "RGB":
                    img = img.convert("RGB")
                return (f"{filename}_page_{i+1}", img)

            _run_batch_lazy(job, load_page, total)
            doc.close()
            del pdf_bytes  # Release the PDF bytes

        except Exception as e:
            job.status = "error"
            job.error = f"Failed to process PDF: {str(e)}"

    thread = threading.Thread(target=_worker, daemon=True)
    thread.start()


def start_batch_from_images(job: BatchJob, image_list: List[tuple]) -> None:
    """
    Process a list of image files lazily.
    image_list: [(filename, bytes), ...]
    """
    def _worker():
        try:
            total = len(image_list)

            def load_image(i: int):
                """Load a single image — only when needed."""
                fname, file_bytes = image_list[i]
                if fname.lower().endswith(".pdf"):
                    from app.services.ocr import pdf_to_image
                    img = pdf_to_image(file_bytes)
                else:
                    img = Image.open(io.BytesIO(file_bytes))
                if img.mode != "RGB":
                    img = img.convert("RGB")
                return (fname, img)

            _run_batch_lazy(job, load_image, total)

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
