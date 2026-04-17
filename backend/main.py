import io
import os
import re
import json
import sqlite3
import tempfile
import asyncio
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from PIL import Image, ImageEnhance, ImageFilter
import pytesseract
import fitz  # PyMuPDF

try:
    import anthropic
    HAS_ANTHROPIC = True
except ImportError:
    HAS_ANTHROPIC = False

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

app = FastAPI(title="ScanDB API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

executor = ThreadPoolExecutor(max_workers=4)

# =============================================
# DOCUMENT TYPE PATTERNS
# =============================================
# Each type has a list of regex patterns and a confidence weight.
# Match score = sum of matched pattern weights / total weight for that type.
# Identification runs in parallel with OCR — failure defaults to "unknown".

DOCUMENT_TYPES = {
    "confirmation_of_appointment": {
        "label": "Confirmation of Appointment",
        "patterns": [
            (r"CONFIRMATION\s+OF\s+APPOINTMENT", 5),
            (r"HR&D[-\s]*SS/PF", 3),
            (r"confirmed\s+to\s+retiring\s+age", 4),
            (r"letter\s+of\s+appointment\s+remain", 3),
            (r"Appointments\s+and\s+Promotions\s+Committee", 2),
            (r"University\s+Health\s+Service", 1),
        ],
        "is_form": False,
        "fields": [
            "ref_number", "date", "name", "department",
            "meeting_date", "appointment_role", "effective_date",
        ],
    },
    "assumption_of_duty": {
        "label": "Assumption of Duty",
        "patterns": [
            (r"Assumption\s+of\s+Duty", 5),
            (r"assumed\s+duty\s+on", 4),
            (r"INTERNAL\s+MEMORANDUM", 2),
            (r"HR&D[-\s]*SS/BUR/PF", 3),
            (r"University\s+payroll", 3),
            (r"To:\s*Bursar", 2),
        ],
        "is_form": False,
        "fields": [
            "ref_number", "date", "name", "designation",
            "appointment_role", "duty_date", "payroll_grade", "effective_date",
        ],
    },
    "promotion_exercise": {
        "label": "Promotion Exercise",
        "patterns": [
            (r"PROMOTION\s+EXERCISE", 5),
            (r"HR&D[-\s]*SS/PRM", 3),
            (r"approved\s+your\s+promotion", 4),
            (r"promotion\s+to\s+the\s+grade", 3),
            (r"salary\s+from\s+that\s+date", 2),
            (r"acknowledge\s+the\s+receipt", 1),
        ],
        "is_form": False,
        "fields": [
            "ref_number", "date", "name", "department",
            "meeting_date", "new_grade", "effective_date",
            "new_salary", "salary_grade",
        ],
    },
    "posting": {
        "label": "Posting",
        "patterns": [
            (r"(?<!\w)POSTING(?!\w)", 5),
            (r"INTERNAL\s+MEMORANDUM", 2),
            (r"posting\s+from\s+the", 4),
            (r"immediate\s+effect", 3),
            (r"hand\s+over\s+any\s+University\s+property", 3),
            (r"new\s+posting", 2),
            (r"HR&D[-\s]*SS/.*/PF", 2),
        ],
        "is_form": False,
        "fields": [
            "ref_number", "date", "name", "department",
            "posting_from", "posting_to", "role", "report_to",
        ],
    },
}


# =============================================
# IMAGE PREPROCESSING FOR HANDWRITING
# =============================================

def preprocess_image(img: Image.Image) -> Image.Image:
    """Enhance image for better OCR, especially handwriting."""
    # Convert to grayscale
    gray = img.convert("L")

    # Increase contrast
    enhancer = ImageEnhance.Contrast(gray)
    gray = enhancer.enhance(1.8)

    # Sharpen
    enhancer = ImageEnhance.Sharpness(gray)
    gray = enhancer.enhance(2.0)

    # Apply slight denoise
    gray = gray.filter(ImageFilter.MedianFilter(size=3))

    # Convert back to RGB for Tesseract
    return gray.convert("RGB")


# =============================================
# DOCUMENT TYPE IDENTIFICATION (PARALLEL)
# =============================================

def identify_document_type(text: str) -> dict:
    """
    Identify document type using regex pattern matching.
    Returns dict with type, label, confidence, is_form.
    This runs as a parallel task — failure returns 'unknown'.
    """
    if not text or not text.strip():
        return {
            "type": "unknown",
            "label": "Unknown Document",
            "confidence": 0,
            "is_form": False,
        }

    scores = {}

    for doc_type, config in DOCUMENT_TYPES.items():
        total_weight = sum(w for _, w in config["patterns"])
        matched_weight = 0

        for pattern, weight in config["patterns"]:
            if re.search(pattern, text, re.IGNORECASE):
                matched_weight += weight

        score = matched_weight / total_weight if total_weight > 0 else 0
        scores[doc_type] = score

    # Get best match
    best_type = max(scores, key=scores.get)
    best_score = scores[best_type]

    # Need at least 30% pattern match to classify
    if best_score < 0.3:
        return {
            "type": "unknown",
            "label": "Unknown Document",
            "confidence": 0,
            "is_form": False,
        }

    # Disambiguate posting vs assumption_of_duty (both have INTERNAL MEMORANDUM)
    if best_type == "posting" and scores.get("assumption_of_duty", 0) > best_score:
        best_type = "assumption_of_duty"
        best_score = scores["assumption_of_duty"]

    config = DOCUMENT_TYPES[best_type]

    return {
        "type": best_type,
        "label": config["label"],
        "confidence": round(best_score * 100, 1),
        "is_form": config["is_form"],
    }


# =============================================
# UNIVERSAL REF NUMBER EXTRACTION
# =============================================

def _extract_ref_number(text: str):
    """
    Universal reference number extractor.
    Tries multiple patterns to capture ref numbers from OCR text,
    handling common OCR errors (& → 8, spacing issues, etc.).
    Returns a match object or a string, or None.
    """
    # Pattern 1: "Ref" / "Ref." / "Ref:" / "Ref No:" followed by content with slashes
    patterns = [
        # HR&D style refs (allow OCR garbling of & to 8, spaces, etc.)
        r"Ref\.?\s*(?:No\.?)?\s*:?\s*(HR\s*[&8]\s*D[-\s/]*\S+[A-Z0-9/\-\.\s]*)",
        # "Our Ref:" or "Your Ref:" style
        r"(?:Our|Your)\s+Ref\.?\s*(?:No\.?)?\s*:?\s*([A-Z0-9][A-Z0-9\s&/\-\.]+)",
        # Generic "Ref:" followed by something that looks like a reference (has slashes or dashes)
        r"Ref\.?\s*(?:No\.?)?\s*:?\s*([A-Z0-9][A-Z0-9\s&/\-\.]{3,})",
        # Ref on its own line followed by content on next line
        r"Ref\.?\s*(?:No\.?)?\s*:?\s*\n\s*([A-Z0-9][A-Z0-9\s&/\-\.]{3,})",
        # Catch alphanumeric/slash sequences near "Ref" keyword
        r"Ref\w*\.?\s*:?\s*([A-Z]{2,}[/\-][A-Z0-9/\-\.]+)",
    ]

    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
        if match:
            val = match.group(1).strip().rstrip(".,;:")
            # Sanity check: ref should have at least one slash or dash and be reasonably short
            if len(val) > 2 and len(val) < 80:
                return match

    return None


# =============================================
# PER-TYPE FIELD EXTRACTION
# =============================================

def extract_confirmation_fields(text: str) -> dict:
    """Extract fields from Confirmation of Appointment."""
    fields = {}

    # Reference number — try specific pattern first, then generic
    ref = re.search(r"Ref\.?:?\s*(HR\s*[&8]\s*D[-\s]*SS/PF[.\w/]*)", text, re.IGNORECASE)
    if not ref:
        ref = _extract_ref_number(text)
    if ref:
        fields["ref_number"] = ref.group(1).strip() if hasattr(ref, 'group') else ref

    # Date (near top of document)
    date = re.search(
        r"(?:Date|Dated?)[:\s]*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\d{1,2}\w*\s+\w+,?\s*\d{4}|\w+\s+\d{1,2},?\s*\d{4})",
        text, re.IGNORECASE
    )
    if date:
        fields["date"] = date.group(1).strip()

    # Name (bold NAME line or Dear Mrs./Mr. line)
    name = re.search(r"Dear\s+(?:Mrs?\.?|Miss|Dr\.?)\s*,?\s*([A-Z][a-zA-Z\s\-\.]+?)(?:\n|,)", text)
    if not name:
        # Look for name after "NAME" label
        name = re.search(r"^(?:NAME)\s*\n\s*(.+?)(?:\n|,)", text, re.MULTILINE)
    if name:
        fields["name"] = name.group(1).strip()

    # Department
    dept = re.search(r"(?:Department|DEPARTMENT)[,:\s]*\n?\s*(.+?)(?:\n|,)", text, re.IGNORECASE)
    if dept:
        fields["department"] = dept.group(1).strip()

    # Meeting date
    meeting = re.search(r"meeting\s+of\s+(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\d{1,2}\w*\s+\w+,?\s*\d{4}|\w+\s+\d{1,2},?\s*\d{4})", text, re.IGNORECASE)
    if meeting:
        fields["meeting_date"] = meeting.group(1).strip()

    # Appointment role
    role = re.search(r"appointment\s+as\s+(.+?)\s+in\s+the", text, re.IGNORECASE)
    if role:
        fields["appointment_role"] = role.group(1).strip().strip("_").strip()

    # Effective date
    effective = re.search(r"effect\s+from\s+(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\d{1,2}\w*\s+\w+,?\s*\d{4}|\w+\s+\d{1,2},?\s*\d{4})", text, re.IGNORECASE)
    if effective:
        fields["effective_date"] = effective.group(1).strip().strip("_").strip()

    return fields


def extract_assumption_fields(text: str) -> dict:
    """Extract fields from Assumption of Duty memo."""
    fields = {}

    # Reference number — try specific pattern first, then generic
    ref = re.search(r"Ref\.?:?\s*(HR\s*[&8]\s*D[-\s]*SS/BUR/PF[.\w/]*)", text, re.IGNORECASE)
    if not ref:
        ref = _extract_ref_number(text)
    if ref:
        fields["ref_number"] = ref.group(1).strip() if hasattr(ref, 'group') else ref

    # Date
    date = re.search(r"Date[:\s]*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\d{1,2}\w*\s+\w+,?\s*\d{4}|\w+\s+\d{1,2},?\s*\d{4})", text, re.IGNORECASE)
    if date:
        fields["date"] = date.group(1).strip()

    # Name — from "Name – Designation" line or body text
    name = re.search(r"Name\s*[-–—]\s*Designation\s*\n?\s*(.+?)(?:\n|$)", text, re.IGNORECASE)
    if name:
        val = name.group(1).strip()
        if val and not val.startswith("I "):
            fields["name"] = val

    # If no name found, try body text
    if "name" not in fields:
        name2 = re.search(r"above\s+named\s+who\s+has\s+been\s+appointed", text, re.IGNORECASE)
        if name2:
            # Name might be filled in by hand — look before this phrase
            pass

    # Designation
    desig = re.search(r"appointed\s+as\s+(.+?)\s+in\s+the", text, re.IGNORECASE)
    if desig:
        fields["designation"] = desig.group(1).strip().strip("_").strip()

    fields["appointment_role"] = fields.get("designation", "")

    # Duty date
    duty = re.search(r"assumed\s+duty\s+on\s+(.+?)(?:\.|,|\n)", text, re.IGNORECASE)
    if duty:
        fields["duty_date"] = duty.group(1).strip().strip("_").strip()

    # Payroll grade
    payroll = re.search(r"payroll,?\s+as\s+(.+?),?\s+with", text, re.IGNORECASE)
    if payroll:
        fields["payroll_grade"] = payroll.group(1).strip().strip("_").strip()

    # Effective date
    effective = re.search(r"effect\s+from\s+(?:the\s+)?(?:date\s+)?(.+?)(?:\.|,|\n)", text, re.IGNORECASE)
    if effective:
        val = effective.group(1).strip().strip("_").strip()
        if "indicated" not in val.lower() and "above" not in val.lower():
            fields["effective_date"] = val

    return fields


def extract_promotion_fields(text: str) -> dict:
    """Extract fields from Promotion Exercise letter."""
    fields = {}

    # Reference number — try specific pattern first, then generic
    ref = re.search(r"Ref\.?\s*(?:No)?\.?:?\s*(HR\s*[&8]\s*D[-\s]*SS/PRM[.\w/]*)", text, re.IGNORECASE)
    if not ref:
        ref = _extract_ref_number(text)
    if ref:
        fields["ref_number"] = ref.group(1).strip() if hasattr(ref, 'group') else ref

    # Date
    date = re.search(r"(?:DATE|Date)[:\s]*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\d{1,2}\w*\s+\w+,?\s*\d{4}|\w+\s+\d{1,2},?\s*\d{4})", text, re.IGNORECASE)
    if date:
        fields["date"] = date.group(1).strip()

    # Name
    name = re.search(r"^(?:NAME)\s*[,:\s]*\n?\s*(.+?)(?:\n|,)", text, re.MULTILINE | re.IGNORECASE)
    if name:
        fields["name"] = name.group(1).strip()

    # Department
    dept = re.search(r"(?:DEPARTMENT|Department)\s*[,:\s]*\n?\s*(.+?)(?:\n|,)", text, re.IGNORECASE)
    if dept:
        fields["department"] = dept.group(1).strip()

    # Meeting date
    meeting = re.search(r"meeting\s+held\s+on\s+(.+?),?\s*approved", text, re.IGNORECASE)
    if meeting:
        fields["meeting_date"] = meeting.group(1).strip().strip(".").strip()

    # New grade
    grade = re.search(r"(?:promotion\s+to\s+the\s+grade\s+of|grade\s+of)\s+(.+?)(?:\s+with|\s*\.)", text, re.IGNORECASE)
    if grade:
        fields["new_grade"] = grade.group(1).strip().strip(".").strip()

    # Effective date
    effective = re.search(r"(?:with\s+)?effect\s+from\s+(.+?)(?:\.|,|\n)", text, re.IGNORECASE)
    if effective:
        fields["effective_date"] = effective.group(1).strip().strip(".").strip()

    # New salary
    salary = re.search(r"salary\s+.*?became\s+(.+?)\s+on", text, re.IGNORECASE)
    if salary:
        fields["new_salary"] = salary.group(1).strip().strip(".").strip()

    # Salary grade
    sal_grade = re.search(r"on\s+(.+?)\s+per\s+annum", text, re.IGNORECASE)
    if sal_grade:
        fields["salary_grade"] = sal_grade.group(1).strip().strip(".").strip()

    return fields


def extract_posting_fields(text: str) -> dict:
    """Extract fields from Posting (Internal Memorandum)."""
    fields = {}

    # Reference number — try specific pattern first, then generic
    ref = re.search(r"Ref\.?\s*(?:No)?\.?:?\s*(HR\s*[&8]\s*D[-\s]*SS/[.\w/]*PF[.\w/]*)", text, re.IGNORECASE)
    if not ref:
        ref = _extract_ref_number(text)
    if ref:
        fields["ref_number"] = ref.group(1).strip() if hasattr(ref, 'group') else ref

    # Date
    date = re.search(r"Date[:\s]*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\d{1,2}\w*\s+\w+,?\s*\d{4}|\w+\s+\d{1,2},?\s*\d{4})", text, re.IGNORECASE)
    if date:
        fields["date"] = date.group(1).strip()

    # Name (TO: field)
    name = re.search(r"TO:\s*(.+?)(?:\n|DEPARTMENT)", text, re.IGNORECASE)
    if name:
        val = name.group(1).strip()
        if val.upper() != "NAME":
            fields["name"] = val

    # Department
    dept = re.search(r"(?:DEPARTMENT|Department)\s*[:\s]*(.+?)(?:\n|$)", text, re.IGNORECASE)
    if dept:
        val = dept.group(1).strip()
        if val.upper() != "DEPARTMENT":
            fields["department"] = val

    # Posting from
    posting_from = re.search(r"posting\s+from\s+(?:the\s+)?(.+?),", text, re.IGNORECASE)
    if posting_from:
        fields["posting_from"] = posting_from.group(1).strip().strip(".").strip()

    # Role (as ... )
    role = re.search(r",\s*(.+?)\s+as\s*\n?\s*(.+?)\s+to\s+", text, re.IGNORECASE)
    if role:
        fields["role"] = role.group(2).strip() if role.group(2).strip() else role.group(1).strip()

    # Posting to
    posting_to = re.search(r"\bto\s+(.+?)\s+with\s+immediate", text, re.IGNORECASE)
    if posting_to:
        fields["posting_to"] = posting_to.group(1).strip().strip(".").strip()

    # Report to
    report = re.search(r"report\s+to\s+(?:the\s+)?(.+?),", text, re.IGNORECASE)
    if report:
        fields["report_to"] = report.group(1).strip().strip(".").strip()

    return fields


# Map type to extraction function
EXTRACTORS = {
    "confirmation_of_appointment": extract_confirmation_fields,
    "assumption_of_duty": extract_assumption_fields,
    "promotion_exercise": extract_promotion_fields,
    "posting": extract_posting_fields,
}


def clean_field_value(value: str) -> str:
    """
    Clean extracted field values by removing OCR filler characters.
    Template forms use lines of dashes, dots, or underscores as
    blank fill-in placeholders — OCR reads these as text.
    """
    if not value:
        return value

    # Strip the value first
    val = value.strip()

    # Remove leading/trailing filler characters
    val = val.strip("-._·…")
    val = val.strip()

    # If the entire value is just filler characters (dashes, dots, underscores, spaces)
    if re.match(r'^[\-\._·…\s]+$', val):
        return ""

    # Remove long runs of filler characters (3+ consecutive)
    val = re.sub(r'[\.]{3,}', '', val)
    val = re.sub(r'[\-]{3,}', '', val)
    val = re.sub(r'[_]{3,}', '', val)
    val = re.sub(r'[·]{3,}', '', val)
    val = re.sub(r'[…]{2,}', '', val)

    # Clean up extra whitespace left behind
    val = re.sub(r'\s{2,}', ' ', val).strip()

    return val


def extract_fields_for_type(text: str, doc_type: str) -> dict:
    """Extract fields based on identified document type."""
    extractor = EXTRACTORS.get(doc_type)
    if extractor:
        fields = extractor(text)
    else:
        fields = extract_fields_generic(text)

    # Clean all field values to remove filler characters
    cleaned = {}
    for k, v in fields.items():
        cleaned_val = clean_field_value(str(v))
        if cleaned_val:  # Only keep non-empty values after cleaning
            cleaned[k] = cleaned_val

    return cleaned


def extract_fields_generic(text: str) -> dict:
    """Generic field extraction fallback."""
    fields = {}

    # Date
    date_match = re.search(
        r'(?:date|dated?|issued?)[:\s]*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\w+ \d{1,2},? \d{4})',
        text, re.IGNORECASE,
    )
    if date_match:
        fields["date"] = date_match.group(1).strip()

    # Reference number (use universal extractor + fallback)
    ref_match = _extract_ref_number(text)
    if ref_match:
        fields["ref_number"] = ref_match.group(1).strip().rstrip(".,;:")

    # Name patterns
    name_match = re.search(r'^NAME\s*[,:\s]*\n?\s*(.+?)(?:\n|,)', text, re.MULTILINE)
    if name_match:
        fields["name"] = name_match.group(1).strip()

    # Department
    dept_match = re.search(r'(?:Department|DEPARTMENT)\s*[,:\s]*\n?\s*(.+?)(?:\n|,)', text, re.IGNORECASE)
    if dept_match:
        fields["department"] = dept_match.group(1).strip()

    # Email
    email_match = re.search(r'[\w.+-]+@[\w-]+\.[\w.]+', text)
    if email_match:
        fields["email"] = email_match.group(0)

    # Phone
    phone_match = re.search(r'[\(]?\d{3}[\)\-\s]?\s*\d{3}[\-\s]?\d{4}', text)
    if phone_match:
        fields["phone"] = phone_match.group(0)

    # Labeled fields (key: value pairs)
    labeled = re.findall(r'^([A-Za-z][A-Za-z\s_]{1,30})\s*[:]\s*(.+)$', text, re.MULTILINE)
    for key, value in labeled:
        k = key.strip().lower().replace(" ", "_")
        if k not in fields:
            fields[k] = value.strip()

    return fields


# =============================================
# PDF HANDLING
# =============================================

def pdf_to_image(pdf_bytes: bytes, dpi: int = 300) -> Image.Image:
    """Convert first page of PDF to PIL Image."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page = doc[0]
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat)
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    doc.close()
    return img


# =============================================
# ENDPOINTS
# =============================================

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "ai_enabled": bool(HAS_ANTHROPIC and ANTHROPIC_API_KEY),
        "document_types": list(DOCUMENT_TYPES.keys()),
    }


@app.post("/scan")
async def scan_document_legacy(file: UploadFile = File(...)):
    """Legacy endpoint — backwards compatible."""
    contents = await file.read()
    filename = file.filename or "unknown"

    try:
        if filename.lower().endswith(".pdf") or file.content_type == "application/pdf":
            img = pdf_to_image(contents)
        else:
            img = Image.open(io.BytesIO(contents))

        if img.mode != "RGB":
            img = img.convert("RGB")

        data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
        raw_text = pytesseract.image_to_string(img)

        confidences = [
            int(c) for c, t in zip(data["conf"], data["text"])
            if int(c) > 0 and t.strip()
        ]
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0

        method = "regex"
        fields = extract_fields_generic(raw_text)

        return {
            "raw_text": raw_text,
            "confidence": round(avg_confidence, 1),
            "fields": fields,
            "method": method,
            "word_count": len([t for t in data["text"] if t.strip()]),
        }

    except Exception as e:
        return JSONResponse(
            status_code=400,
            content={"error": f"Failed to process document: {str(e)}"},
        )


@app.post("/scan-document")
async def scan_document(file: UploadFile = File(...)):
    """
    Smart scan endpoint:
    1. OCR with handwriting support
    2. Identify document type (parallel, non-blocking)
    3. Extract type-specific fields
    4. Return everything for preview + edit
    """
    contents = await file.read()
    filename = file.filename or "unknown"

    try:
        # Convert PDF to image if needed
        if filename.lower().endswith(".pdf") or file.content_type == "application/pdf":
            img = pdf_to_image(contents)
        else:
            img = Image.open(io.BytesIO(contents))

        if img.mode != "RGB":
            img = img.convert("RGB")

        # Preprocess for handwriting
        processed_img = preprocess_image(img)

        # OCR with handwriting-optimized config
        # --psm 6 = Assume uniform block of text
        # --oem 3 = Default OCR engine (works best overall including handwriting)
        custom_config = r'--psm 6 --oem 3'

        # Run OCR on both original and preprocessed concurrently
        loop = asyncio.get_event_loop()

        # Standard OCR
        raw_text_future = loop.run_in_executor(
            executor,
            lambda: pytesseract.image_to_string(img, config=custom_config)
        )

        # Preprocessed OCR (better for handwriting)
        processed_text_future = loop.run_in_executor(
            executor,
            lambda: pytesseract.image_to_string(processed_img, config=custom_config)
        )

        # Word-level data for confidence
        data_future = loop.run_in_executor(
            executor,
            lambda: pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT, config=custom_config)
        )

        raw_text, processed_text, data = await asyncio.gather(
            raw_text_future, processed_text_future, data_future
        )

        # Use the longer text (more content extracted = better OCR)
        best_text = raw_text if len(raw_text.strip()) >= len(processed_text.strip()) else processed_text

        # Calculate confidence
        confidences = [
            int(c) for c, t in zip(data["conf"], data["text"])
            if int(c) > 0 and t.strip()
        ]
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0

        # PARALLEL: Identify document type (non-blocking)
        doc_type_future = loop.run_in_executor(
            executor,
            identify_document_type,
            best_text
        )

        # Wait for identification
        doc_info = await doc_type_future

        # Extract fields based on identified type
        extracted_fields = extract_fields_for_type(best_text, doc_info["type"])

        # Clean empty values and filler characters
        extracted_fields = {
            k: clean_field_value(str(v))
            for k, v in extracted_fields.items()
            if v and str(v).strip()
        }
        # Remove fields that became empty after cleaning
        extracted_fields = {k: v for k, v in extracted_fields.items() if v}

        return {
            "raw_text": best_text,
            "confidence": round(avg_confidence, 1),
            "document_type": doc_info["type"],
            "document_label": doc_info["label"],
            "type_confidence": doc_info["confidence"],
            "is_form": doc_info["is_form"],
            "fields": extracted_fields,
            "expected_fields": DOCUMENT_TYPES.get(doc_info["type"], {}).get("fields", []),
            "method": "regex",
            "word_count": len([t for t in data["text"] if t.strip()]),
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse(
            status_code=400,
            content={"error": f"Failed to process document: {str(e)}"},
        )


@app.post("/export")
async def export_db(
    file_name: str = "scan",
    raw_text: str = "",
    confidence: float = 0,
    fields: str = "{}",
):
    """Generate and return a SQLite .db file."""
    parsed_fields = json.loads(fields) if isinstance(fields, str) else fields

    # Create in-memory SQLite database
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

    # Create flat data table
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
