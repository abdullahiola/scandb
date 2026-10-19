"""
OCR service backed by PaddleOCR (PP-OCRv5).

A single engine instance is shared across the app. Model files are
downloaded automatically on first use (or pre-baked in the Docker image).
Predictions are serialized with a lock — the Paddle predictor is not
thread-safe, and one inference at a time keeps memory bounded on a VPS.
"""

import io
import os
import threading
from typing import Any, Dict, List, Optional

import numpy as np
from PIL import Image
import fitz  # PyMuPDF


_engine = None
_engine_lock = threading.Lock()
_predict_lock = threading.Lock()


def get_engine():
    """Lazily create the shared PaddleOCR engine."""
    global _engine
    if _engine is None:
        with _engine_lock:
            if _engine is None:
                from paddleocr import PaddleOCR

                # Mobile models: near-server accuracy on printed docs but
                # orders of magnitude faster on CPU. Override via env for
                # higher-accuracy variants (e.g. PP-OCRv6_medium_*).
                _engine = PaddleOCR(
                    text_detection_model_name=os.environ.get(
                        "OCR_DET_MODEL", "PP-OCRv5_mobile_det"
                    ),
                    text_recognition_model_name=os.environ.get(
                        "OCR_REC_MODEL", "PP-OCRv5_mobile_rec"
                    ),
                    # Auto-rotate documents photographed sideways/upside down
                    use_doc_orientation_classify=True,
                    use_doc_unwarping=False,
                    use_textline_orientation=False,
                )
    return _engine


def _box_bounds(box) -> Optional[tuple]:
    """Normalize a detection box ([x1,y1,x2,y2] or 4-point polygon) to bounds."""
    arr = np.asarray(box, dtype=float).reshape(-1)
    if arr.size == 4:
        x1, y1, x2, y2 = arr
        return float(x1), float(y1), float(x2), float(y2)
    if arr.size >= 8:
        xs, ys = arr[0::2], arr[1::2]
        return float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max())
    return None


def _assemble_text(texts: List[str], boxes) -> str:
    """
    Rebuild document text from detected line fragments.
    Fragments whose vertical centers overlap are merged into one visual
    line (left to right), so form labels and their values stay together
    for the downstream regex extractors.
    """
    items = []
    for i, text in enumerate(texts):
        text = (text or "").strip()
        if not text:
            continue
        bounds = _box_bounds(boxes[i]) if boxes is not None and i < len(boxes) else None
        if bounds is None:
            items.append({"text": text, "x": 0.0, "yc": float(len(items)) * 100, "h": 10.0})
            continue
        x1, y1, x2, y2 = bounds
        items.append({"text": text, "x": x1, "yc": (y1 + y2) / 2, "h": max(y2 - y1, 1.0)})

    items.sort(key=lambda it: it["yc"])

    lines: List[Dict[str, Any]] = []
    for it in items:
        if lines:
            last = lines[-1]
            if abs(it["yc"] - last["yc"]) < max(it["h"], last["h"]) * 0.6:
                last["items"].append(it)
                last["yc"] = sum(x["yc"] for x in last["items"]) / len(last["items"])
                last["h"] = max(last["h"], it["h"])
                continue
        lines.append({"items": [it], "yc": it["yc"], "h": it["h"]})

    out = []
    for line in lines:
        line["items"].sort(key=lambda x: x["x"])
        out.append(" ".join(x["text"] for x in line["items"]))
    return "\n".join(out)


def run_ocr(img: Image.Image) -> Dict[str, Any]:
    """
    OCR a PIL image. Returns:
      raw_text     — text with visual line structure preserved
      confidence   — average recognition confidence, 0-100
      line_scores  — per-line confidences (0-100), for multi-page averaging
      word_count   — number of recognized words
    """
    if img.mode != "RGB":
        img = img.convert("RGB")

    engine = get_engine()
    with _predict_lock:
        results = engine.predict(np.array(img))

    if not results:
        return {"raw_text": "", "confidence": 0.0, "line_scores": [], "word_count": 0}

    res = results[0]
    texts = list(res.get("rec_texts") or [])
    scores = list(res.get("rec_scores") or [])
    boxes = res.get("rec_boxes")
    if boxes is None or len(boxes) == 0:
        boxes = res.get("rec_polys")

    raw_text = _assemble_text(texts, boxes)
    line_scores = [float(s) * 100 for s, t in zip(scores, texts) if t and t.strip()]
    confidence = sum(line_scores) / len(line_scores) if line_scores else 0.0
    word_count = sum(len(t.split()) for t in texts if t)

    return {
        "raw_text": raw_text,
        "confidence": round(confidence, 1),
        "line_scores": line_scores,
        "word_count": word_count,
    }


def pdf_to_images(pdf_bytes: bytes, dpi: int = 200) -> List[Image.Image]:
    """Convert ALL pages of a PDF to PIL Images."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    images = []
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    for page in doc:
        pix = page.get_pixmap(matrix=mat)
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        images.append(img)
    doc.close()
    return images


def pdf_to_image(pdf_bytes: bytes, dpi: int = 200) -> Image.Image:
    """Convert first page of PDF to PIL Image (legacy compat)."""
    images = pdf_to_images(pdf_bytes, dpi)
    return images[0] if images else Image.new("RGB", (100, 100), "white")
