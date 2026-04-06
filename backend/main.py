import io
import os
import re
import json
import sqlite3
import tempfile
from datetime import datetime

from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from PIL import Image
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


def pdf_to_image(pdf_bytes: bytes, dpi: int = 300) -> Image.Image:
    """Convert first page of PDF to PIL Image."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page = doc[0]
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat)
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    doc.close()
    return img


def extract_fields(text: str) -> dict:
    """Regex-based field extraction."""
    fields = {}

    # Date
    date_match = re.search(
        r'(?:date|dated?|issued?)[:\s]*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\w+ \d{1,2},? \d{4})',
        text, re.IGNORECASE,
    )
    if date_match:
        fields["date"] = date_match.group(1).strip()

    # Invoice number
    inv_match = re.search(r'(?:invoice|inv|bill|receipt)\s*[#:no.]*\s*(\w[\w\-]+)', text, re.IGNORECASE)
    if inv_match:
        fields["number"] = inv_match.group(1).strip()

    # Amounts
    amounts = re.findall(r'\$[\d,]+\.?\d*', text)
    if amounts:
        cleaned = [float(a.replace('$', '').replace(',', '')) for a in amounts]
        fields["total"] = f"${max(cleaned):,.2f}"

    # Bill to
    bill_match = re.search(r'(?:bill\s*to|customer|client|name)[:\s]*([A-Z][a-z]+ [A-Z][a-z]+)', text)
    if bill_match:
        fields["bill_to"] = bill_match.group(1).strip()

    # Email
    email_match = re.search(r'[\w.+-]+@[\w-]+\.[\w.]+', text)
    if email_match:
        fields["email"] = email_match.group(0)

    # Phone
    phone_match = re.search(r'[\(]?\d{3}[\)\-\s]?\s*\d{3}[\-\s]?\d{4}', text)
    if phone_match:
        fields["phone"] = phone_match.group(0)

    # Subtotal
    sub_match = re.search(r'subtotal[:\s]*\$?([\d,]+\.?\d*)', text, re.IGNORECASE)
    if sub_match:
        fields["subtotal"] = f"${sub_match.group(1)}"

    # Tax
    tax_match = re.search(r'tax[:\s]*\$?([\d,]+\.?\d*)', text, re.IGNORECASE)
    if tax_match:
        fields["tax"] = f"${tax_match.group(1)}"

    return fields


def ai_extract_fields(text: str) -> dict:
    """Use Claude AI for intelligent field extraction."""
    if not HAS_ANTHROPIC or not ANTHROPIC_API_KEY:
        return {}

    try:
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            messages=[{
                "role": "user",
                "content": f"""Extract key fields from this document text. Return ONLY a JSON object with the extracted fields.

Rules:
- Use snake_case keys (e.g. invoice_number, bill_to, total_amount)
- Include: dates, names, addresses, amounts, reference numbers, contact info
- Only include fields you are confident about
- Return raw JSON only, no markdown, no explanation

Document text:
{text}"""
            }],
        )

        raw = message.content[0].text.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = re.sub(r"^```\w*\n?", "", raw)
            raw = re.sub(r"\n?```$", "", raw)
        return json.loads(raw)
    except Exception as e:
        print(f"AI extraction failed: {e}")
        return {}


@app.get("/health")
async def health():
    return {"status": "ok", "ai_enabled": bool(HAS_ANTHROPIC and ANTHROPIC_API_KEY)}


@app.post("/scan")
async def scan_document(file: UploadFile = File(...)):
    """Accept image or PDF, return OCR text + extracted fields."""
    contents = await file.read()
    filename = file.filename or "unknown"

    try:
        # Convert PDF to image if needed
        if filename.lower().endswith(".pdf") or file.content_type == "application/pdf":
            img = pdf_to_image(contents)
        else:
            img = Image.open(io.BytesIO(contents))

        # Convert to RGB if needed
        if img.mode != "RGB":
            img = img.convert("RGB")

        # OCR
        data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)

        # Build text
        raw_text = pytesseract.image_to_string(img)

        # Calculate confidence (average of non-empty word confidences)
        confidences = [
            int(c) for c, t in zip(data["conf"], data["text"])
            if int(c) > 0 and t.strip()
        ]
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0

        # Extract fields — try AI first, fallback to regex
        method = "regex"
        fields = {}

        if HAS_ANTHROPIC and ANTHROPIC_API_KEY and raw_text.strip():
            ai_fields = ai_extract_fields(raw_text)
            if ai_fields:
                fields = ai_fields
                method = "ai"

        if not fields:
            fields = extract_fields(raw_text)
            method = "regex"

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

    import os
    os.unlink(db_path)

    return StreamingResponse(
        io.BytesIO(db_bytes),
        media_type="application/x-sqlite3",
        headers={
            "Content-Disposition": f'attachment; filename="scan_{int(datetime.now().timestamp())}.db"',
        },
    )
