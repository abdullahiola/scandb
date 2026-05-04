import re

from app.utils.fields import _extract_ref_number, clean_field_value, extract_fields_generic

# =============================================
# DOCUMENT TYPE PATTERNS
# =============================================

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


def identify_document_type(text: str) -> dict:
    """Identify document type using regex pattern matching."""
    if not text or not text.strip():
        return {"type": "unknown", "label": "Unknown Document", "confidence": 0, "is_form": False}

    scores = {}
    for doc_type, config in DOCUMENT_TYPES.items():
        total_weight = sum(w for _, w in config["patterns"])
        matched_weight = sum(
            weight for pattern, weight in config["patterns"]
            if re.search(pattern, text, re.IGNORECASE)
        )
        scores[doc_type] = matched_weight / total_weight if total_weight > 0 else 0

    best_type = max(scores, key=scores.get)
    best_score = scores[best_type]

    if best_score < 0.3:
        return {"type": "unknown", "label": "Unknown Document", "confidence": 0, "is_form": False}

    # Disambiguate posting vs assumption_of_duty
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
# PER-TYPE FIELD EXTRACTORS
# =============================================

def extract_confirmation_fields(text: str) -> dict:
    """Extract fields from Confirmation of Appointment."""
    fields = {}
    ref = re.search(r"Ref\.?:?\s*(HR\s*[&8]\s*D[-\s]*SS/PF[.\w/]*)", text, re.IGNORECASE)
    if not ref:
        ref = _extract_ref_number(text)
    if ref:
        fields["ref_number"] = ref.group(1).strip() if hasattr(ref, 'group') else ref

    date = re.search(r"(?:Date|Dated?)[:\s]*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\d{1,2}\w*\s+\w+,?\s*\d{4}|\w+\s+\d{1,2},?\s*\d{4})", text, re.IGNORECASE)
    if date:
        fields["date"] = date.group(1).strip()

    name = re.search(r"Dear\s+(?:Mrs?\.?|Miss|Dr\.?)\s*,?\s*([A-Z][a-zA-Z\s\-\.]+?)(?:\n|,)", text)
    if not name:
        name = re.search(r"^(?:NAME)\s*\n\s*(.+?)(?:\n|,)", text, re.MULTILINE)
    if name:
        fields["name"] = name.group(1).strip()

    dept = re.search(r"(?:Department|DEPARTMENT)[,:\s]*\n?\s*(.+?)(?:\n|,)", text, re.IGNORECASE)
    if dept:
        fields["department"] = dept.group(1).strip()

    meeting = re.search(r"meeting\s+of\s+(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\d{1,2}\w*\s+\w+,?\s*\d{4}|\w+\s+\d{1,2},?\s*\d{4})", text, re.IGNORECASE)
    if meeting:
        fields["meeting_date"] = meeting.group(1).strip()

    role = re.search(r"appointment\s+as\s+(.+?)\s+in\s+the", text, re.IGNORECASE)
    if role:
        fields["appointment_role"] = role.group(1).strip().strip("_").strip()

    effective = re.search(r"effect\s+from\s+(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\d{1,2}\w*\s+\w+,?\s*\d{4}|\w+\s+\d{1,2},?\s*\d{4})", text, re.IGNORECASE)
    if effective:
        fields["effective_date"] = effective.group(1).strip().strip("_").strip()

    return fields


def extract_assumption_fields(text: str) -> dict:
    """Extract fields from Assumption of Duty memo."""
    fields = {}
    ref = re.search(r"Ref\.?:?\s*(HR\s*[&8]\s*D[-\s]*SS/BUR/PF[.\w/]*)", text, re.IGNORECASE)
    if not ref:
        ref = _extract_ref_number(text)
    if ref:
        fields["ref_number"] = ref.group(1).strip() if hasattr(ref, 'group') else ref

    date = re.search(r"Date[:\s]*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\d{1,2}\w*\s+\w+,?\s*\d{4}|\w+\s+\d{1,2},?\s*\d{4})", text, re.IGNORECASE)
    if date:
        fields["date"] = date.group(1).strip()

    name = re.search(r"Name\s*[-–—]\s*Designation\s*\n?\s*(.+?)(?:\n|$)", text, re.IGNORECASE)
    if name:
        val = name.group(1).strip()
        if val and not val.startswith("I "):
            fields["name"] = val

    desig = re.search(r"appointed\s+as\s+(.+?)\s+in\s+the", text, re.IGNORECASE)
    if desig:
        fields["designation"] = desig.group(1).strip().strip("_").strip()
    fields["appointment_role"] = fields.get("designation", "")

    duty = re.search(r"assumed\s+duty\s+on\s+(.+?)(?:\.|,|\n)", text, re.IGNORECASE)
    if duty:
        fields["duty_date"] = duty.group(1).strip().strip("_").strip()

    payroll = re.search(r"payroll,?\s+as\s+(.+?),?\s+with", text, re.IGNORECASE)
    if payroll:
        fields["payroll_grade"] = payroll.group(1).strip().strip("_").strip()

    effective = re.search(r"effect\s+from\s+(?:the\s+)?(?:date\s+)?(.+?)(?:\.|,|\n)", text, re.IGNORECASE)
    if effective:
        val = effective.group(1).strip().strip("_").strip()
        if "indicated" not in val.lower() and "above" not in val.lower():
            fields["effective_date"] = val

    return fields


def extract_promotion_fields(text: str) -> dict:
    """Extract fields from Promotion Exercise letter."""
    fields = {}
    ref = re.search(r"Ref\.?\s*(?:No)?\.?:?\s*(HR\s*[&8]\s*D[-\s]*SS/PRM[.\w/]*)", text, re.IGNORECASE)
    if not ref:
        ref = _extract_ref_number(text)
    if ref:
        fields["ref_number"] = ref.group(1).strip() if hasattr(ref, 'group') else ref

    date = re.search(r"(?:DATE|Date)[:\s]*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\d{1,2}\w*\s+\w+,?\s*\d{4}|\w+\s+\d{1,2},?\s*\d{4})", text, re.IGNORECASE)
    if date:
        fields["date"] = date.group(1).strip()

    name = re.search(r"^(?:NAME)\s*[,:\s]*\n?\s*(.+?)(?:\n|,)", text, re.MULTILINE | re.IGNORECASE)
    if name:
        fields["name"] = name.group(1).strip()

    dept = re.search(r"(?:DEPARTMENT|Department)\s*[,:\s]*\n?\s*(.+?)(?:\n|,)", text, re.IGNORECASE)
    if dept:
        fields["department"] = dept.group(1).strip()

    meeting = re.search(r"meeting\s+held\s+on\s+(.+?),?\s*approved", text, re.IGNORECASE)
    if meeting:
        fields["meeting_date"] = meeting.group(1).strip().strip(".").strip()

    grade = re.search(r"(?:promotion\s+to\s+the\s+grade\s+of|grade\s+of)\s+(.+?)(?:\s+with|\s*\.)", text, re.IGNORECASE)
    if grade:
        fields["new_grade"] = grade.group(1).strip().strip(".").strip()

    effective = re.search(r"(?:with\s+)?effect\s+from\s+(.+?)(?:\.|,|\n)", text, re.IGNORECASE)
    if effective:
        fields["effective_date"] = effective.group(1).strip().strip(".").strip()

    salary = re.search(r"salary\s+.*?became\s+(.+?)\s+on", text, re.IGNORECASE)
    if salary:
        fields["new_salary"] = salary.group(1).strip().strip(".").strip()

    sal_grade = re.search(r"on\s+(.+?)\s+per\s+annum", text, re.IGNORECASE)
    if sal_grade:
        fields["salary_grade"] = sal_grade.group(1).strip().strip(".").strip()

    return fields


def extract_posting_fields(text: str) -> dict:
    """Extract fields from Posting (Internal Memorandum)."""
    fields = {}
    ref = re.search(r"Ref\.?\s*(?:No)?\.?:?\s*(HR\s*[&8]\s*D[-\s]*SS/[.\w/]*PF[.\w/]*)", text, re.IGNORECASE)
    if not ref:
        ref = _extract_ref_number(text)
    if ref:
        fields["ref_number"] = ref.group(1).strip() if hasattr(ref, 'group') else ref

    date = re.search(r"Date[:\s]*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\d{1,2}\w*\s+\w+,?\s*\d{4}|\w+\s+\d{1,2},?\s*\d{4})", text, re.IGNORECASE)
    if date:
        fields["date"] = date.group(1).strip()

    name = re.search(r"TO:\s*(.+?)(?:\n|DEPARTMENT)", text, re.IGNORECASE)
    if name:
        val = name.group(1).strip()
        if val.upper() != "NAME":
            fields["name"] = val

    dept = re.search(r"(?:DEPARTMENT|Department)\s*[:\s]*(.+?)(?:\n|$)", text, re.IGNORECASE)
    if dept:
        val = dept.group(1).strip()
        if val.upper() != "DEPARTMENT":
            fields["department"] = val

    posting_from = re.search(r"posting\s+from\s+(?:the\s+)?(.+?),", text, re.IGNORECASE)
    if posting_from:
        fields["posting_from"] = posting_from.group(1).strip().strip(".").strip()

    role = re.search(r",\s*(.+?)\s+as\s*\n?\s*(.+?)\s+to\s+", text, re.IGNORECASE)
    if role:
        fields["role"] = role.group(2).strip() if role.group(2).strip() else role.group(1).strip()

    posting_to = re.search(r"\bto\s+(.+?)\s+with\s+immediate", text, re.IGNORECASE)
    if posting_to:
        fields["posting_to"] = posting_to.group(1).strip().strip(".").strip()

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


def extract_fields_for_type(text: str, doc_type: str) -> dict:
    """Extract fields based on identified document type."""
    extractor = EXTRACTORS.get(doc_type)
    if extractor:
        fields = extractor(text)
    else:
        fields = extract_fields_generic(text)

    # Clean all field values
    cleaned = {}
    for k, v in fields.items():
        cleaned_val = clean_field_value(str(v))
        if cleaned_val:
            cleaned[k] = cleaned_val
    return cleaned
