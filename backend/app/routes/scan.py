import io
import asyncio
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, UploadFile, File
from fastapi.responses import JSONResponse
from PIL import Image
import pytesseract

from app.services.ocr import preprocess_image, pdf_to_image
from app.services.classifier import (
    identify_document_type, extract_fields_for_type, DOCUMENT_TYPES,
)
from app.utils.fields import clean_field_value, extract_fields_generic

router = APIRouter()
executor = ThreadPoolExecutor(max_workers=4)


@router.post("/scan")
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
    Smart scan endpoint:
    1. OCR with handwriting support
    2. Identify document type (parallel)
    3. Extract type-specific fields
    """
    contents = await file.read()
    filename = file.filename or "unknown"

    try:
        if filename.lower().endswith(".pdf") or file.content_type == "application/pdf":
            img = pdf_to_image(contents)
        else:
            img = Image.open(io.BytesIO(contents))

        if img.mode != "RGB":
            img = img.convert("RGB")

        processed_img = preprocess_image(img)
        custom_config = r'--psm 6 --oem 3'

        loop = asyncio.get_event_loop()

        raw_text_future = loop.run_in_executor(
            executor, lambda: pytesseract.image_to_string(img, config=custom_config)
        )
        processed_text_future = loop.run_in_executor(
            executor, lambda: pytesseract.image_to_string(processed_img, config=custom_config)
        )
        data_future = loop.run_in_executor(
            executor, lambda: pytesseract.image_to_data(
                img, output_type=pytesseract.Output.DICT, config=custom_config
            )
        )

        raw_text, processed_text, data = await asyncio.gather(
            raw_text_future, processed_text_future, data_future
        )

        best_text = raw_text if len(raw_text.strip()) >= len(processed_text.strip()) else processed_text

        confidences = [
            int(c) for c, t in zip(data["conf"], data["text"])
            if int(c) > 0 and t.strip()
        ]
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0

        doc_info = await loop.run_in_executor(executor, identify_document_type, best_text)
        extracted_fields = extract_fields_for_type(best_text, doc_info["type"])

        # Clean empty values
        extracted_fields = {
            k: clean_field_value(str(v))
            for k, v in extracted_fields.items()
            if v and str(v).strip()
        }
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
        return JSONResponse(status_code=400, content={"error": f"Failed to process document: {str(e)}"})
