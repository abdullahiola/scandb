import re


def _extract_ref_number(text: str):
    """
    Universal reference number extractor.
    Tries multiple patterns to capture ref numbers from OCR text.
    """
    patterns = [
        r"Ref\.?\s*(?:No\.?)?\s*:?\s*(HR\s*[&8]\s*D[-\s/]*\S+[A-Z0-9/\-\.\s]*)",
        r"(?:Our|Your)\s+Ref\.?\s*(?:No\.?)?\s*:?\s*([A-Z0-9][A-Z0-9\s&/\-\.]+)",
        r"Ref\.?\s*(?:No\.?)?\s*:?\s*([A-Z0-9][A-Z0-9\s&/\-\.]{3,})",
        r"Ref\.?\s*(?:No\.?)?\s*:?\s*\n\s*([A-Z0-9][A-Z0-9\s&/\-\.]{3,})",
        r"Ref\w*\.?\s*:?\s*([A-Z]{2,}[/\-][A-Z0-9/\-\.]+)",
    ]

    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
        if match:
            val = match.group(1).strip().rstrip(".,;:")
            if 2 < len(val) < 80:
                return match
    return None


def clean_field_value(value: str) -> str:
    """Clean extracted field values by removing OCR filler characters."""
    if not value:
        return value

    val = value.strip()
    val = val.strip("-._·…")
    val = val.strip()

    if re.match(r'^[\-\._·…\s]+$', val):
        return ""

    val = re.sub(r'[\.]{3,}', '', val)
    val = re.sub(r'[\-]{3,}', '', val)
    val = re.sub(r'[_]{3,}', '', val)
    val = re.sub(r'[·]{3,}', '', val)
    val = re.sub(r'[…]{2,}', '', val)
    val = re.sub(r'\s{2,}', ' ', val).strip()

    return val


def extract_fields_generic(text: str) -> dict:
    """Generic field extraction fallback."""
    fields = {}

    date_match = re.search(
        r'(?:date|dated?|issued?)[:\s]*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\w+ \d{1,2},? \d{4})',
        text, re.IGNORECASE,
    )
    if date_match:
        fields["date"] = date_match.group(1).strip()

    ref_match = _extract_ref_number(text)
    if ref_match:
        fields["ref_number"] = ref_match.group(1).strip().rstrip(".,;:")

    name_match = re.search(r'^NAME\s*[,:\s]*\n?\s*(.+?)(?:\n|,)', text, re.MULTILINE)
    if name_match:
        fields["name"] = name_match.group(1).strip()

    dept_match = re.search(r'(?:Department|DEPARTMENT)\s*[,:\s]*\n?\s*(.+?)(?:\n|,)', text, re.IGNORECASE)
    if dept_match:
        fields["department"] = dept_match.group(1).strip()

    email_match = re.search(r'[\w.+-]+@[\w-]+\.[\w.]+', text)
    if email_match:
        fields["email"] = email_match.group(0)

    phone_match = re.search(r'[\(]?\d{3}[\)\-\s]?\s*\d{3}[\-\s]?\d{4}', text)
    if phone_match:
        fields["phone"] = phone_match.group(0)

    labeled = re.findall(r'^([A-Za-z][A-Za-z\s_]{1,30})\s*[:]\s*(.+)$', text, re.MULTILINE)
    for key, value in labeled:
        k = key.strip().lower().replace(" ", "_")
        if k not in fields:
            fields[k] = value.strip()

    return fields
