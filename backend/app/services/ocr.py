import io
from typing import List

from PIL import Image, ImageEnhance, ImageFilter
import pytesseract
import fitz  # PyMuPDF


def preprocess_image(img: Image.Image) -> Image.Image:
    """Enhance image for better OCR, especially handwriting."""
    gray = img.convert("L")
    enhancer = ImageEnhance.Contrast(gray)
    gray = enhancer.enhance(1.8)
    enhancer = ImageEnhance.Sharpness(gray)
    gray = enhancer.enhance(2.0)
    gray = gray.filter(ImageFilter.MedianFilter(size=3))
    return gray.convert("RGB")


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


def run_ocr(img: Image.Image, config: str = "") -> dict:
    """Run OCR and return raw_text + word-level data."""
    data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT, config=config)
    raw_text = pytesseract.image_to_string(img, config=config)
    return {"raw_text": raw_text, "data": data}
