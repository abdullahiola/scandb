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
    "SDC": {
        "label": "Senior Staff Disciplinary Committee",
        "patterns": [
            (r"COUNCIL\s+DECISION", 5),
            (r"Senior\s+Staff\s+Disciplinary\s+Committee", 5),
            (r"SSDC", 4),
            (r"allegations\s+leveled\s+against", 4),
            (r"appeal.*?twenty[- ]one\s*\(21\)\s*days", 3),
            (r"HR&D[-\s]*SS/.*?/PF", 2),
            (r"Deputy\s+Registrar.*?HR&D/NA[-\s]*SS", 2),
        ],
        "is_form": False,
        "fields": [
            "ref_number", "date", "name", "department",
            "council_decision", "meeting_date",
        ],
    },
    "co_name": {
        "label": "Change of Name",
        "patterns": [
            (r"change\s+in\s+your\s+name", 5),
            (r"name\s+has\s+been\s+amended", 5),
            (r"INTERNAL\s+MEMORANDUM", 2),
            (r"HR&D[-\s]*SNAS", 3),
            (r"Bursar\s+is\s+being\s+informed", 3),
            (r"Deputy\s+Registrar.*?HR&D/SNAS", 2),
        ],
        "is_form": True,
        "fields": [
            "ref_number", "date", "name", "department",
            "name_from", "name_to",
        ],
    },
    "co_next_of_kin": {
        "label": "Change of Next-of-Kin",
        "patterns": [
            (r"change\s+of\s+your\s+next[- ]of[- ]kin", 5),
            (r"next[- ]of[- ]kin\s+as\s+follows", 4),
            (r"INTERNAL\s+MEMORANDUM", 2),
            (r"HR&D[-\s]*SNAS", 3),
            (r"record\s+has\s+been\s+amended\s+accordingly", 3),
            (r"Human\s+Resource\s+and\s+Development.*?SNAS", 2),
        ],
        "is_form": True,
        "fields": [
            "ref_number", "date", "name", "department",
            "nok_from", "nok_to",
        ],
    },
    "redeployment": {
        "label": "Redeployment",
        "patterns": [
            (r"(?<!\w)REDEPLOYMENT(?!\w)", 5),
            (r"redeployment\s+from\s+your\s+present\s+schedule", 5),
            (r"REG/HR&D[-\s]*SS", 3),
            (r"hand\s+over\s+all\s+University\s+property", 3),
            (r"hand\s+over\s+notes", 3),
            (r"new\s+posting.*?experience", 2),
            (r"loyalty\s+and\s+dedication\s+to\s+duty", 2),
        ],
        "is_form": False,
        "fields": [
            "ref_number", "date", "name", "department",
            "redeployment_from", "redeployment_to", "effective_date",
        ],
    },
    "maternity_leave": {
        "label": "Maternity Leave",
        "patterns": [
            (r"Maternity\s+leave", 5),
            (r"one\s+hundred\s+and\s+twelve\s*\(112\)", 5),
            (r"INTERNAL\s+MEMORANDUM", 2),
            (r"HR&D[-\s]*SNAS", 3),
            (r"resume\s+duty\s+in\s+your\s+Department", 3),
            (r"safe\s+delivery", 2),
            (r"annual\s+leave", 2),
            (r"Vice\s+Chancellor", 1),
        ],
        "is_form": True,
        "fields": [
            "ref_number", "date", "name", "department",
            "leave_start", "leave_duration", "resume_date",
        ],
    },
    "deferment": {
        "label": "Deferment of Leave",
        "patterns": [
            (r"short[-\s]*term\s+deferment", 5),
            (r"deferment\s+of\s+your", 5),
            (r"Vice\s+Chancellor.?s\s+approval", 4),
            (r"annual\s+leave\s+of", 3),
            (r"INTERNAL\s+MEMORANDUM", 2),
            (r"HR&D[-\s]*SNAS", 3),
            (r"utilize\s+the\s+leave\s+at\s+the\s+convenience", 3),
        ],
        "is_form": True,
        "fields": [
            "ref_number", "date", "name", "department",
            "subject", "leave_days",
        ],
    },
    "extension_of_probationary": {
        "label": "Extension of Probationary Appointment",
        "patterns": [
            (r"Extension\s+of\s+Probationary\s+Appointment", 5),
            (r"extension\s+of\s+the\s+probationary", 5),
            (r"another\s+six\s*\(6\)\s*months", 4),
            (r"Appointments\s+and\s+Promotions\s+Committee", 3),
            (r"INTERNAL\s+MEMORANDUM", 2),
            (r"HR&D[-\s]*SS", 3),
            (r"pending\s+its\s+next\s+meeting", 2),
        ],
        "is_form": True,
        "fields": [
            "ref_number", "date", "name", "department",
            "designation", "assumption_date", "extension_from",
        ],
    },
    "leave_approval": {
        "label": "Leave Approval",
        "patterns": [
            (r"approval\s+of\s+the\s+Registrar\s+for\s+you\s+to\s+utilize", 5),
            (r"leave\s+entitlement\s+for\s+the\s+year", 5),
            (r"resume\s+duty\s+in\s+your\s+office", 4),
            (r"formally\s+inform\s+the\s+Human\s+Resource", 3),
            (r"INTERNAL\s+MEMORANDUM", 2),
            (r"HR&D[-\s]*SNAS", 3),
            (r"annual\s+leave\s+entitlement", 3),
        ],
        "is_form": True,
        "fields": [
            "ref_number", "date", "name", "department",
            "subject", "leave_days", "leave_start", "resume_date",
        ],
    },
    "ac_of_leave": {
        "label": "Accumulated Leave",
        "patterns": [
            (r"accumulated\s+leave", 5),
            (r"information\s+on\s+your\s+accumulated\s+leave", 5),
            (r"Number\s+of\s+working\s+days", 4),
            (r"INTERNAL\s+MEMORANDUM", 2),
            (r"HR&D[/\s]*SNAS", 3),
            (r"TOTAL", 2),
            (r"DEVELOPMENT\s+DIVISION/SNAS", 2),
        ],
        "is_form": True,
        "fields": [
            "ref_number", "date", "name", "department",
            "subject", "total_days",
        ],
    },
    "appraisal": {
        "label": "Appraisal / Certificate Acknowledgement",
        "patterns": [
            (r"acknowledge\s+receipt\s+of\s+your\s+Memorandum", 5),
            (r"successful\s+completion\s+of", 5),
            (r"notification\s+of\s+a\s+successful\s+completion", 4),
            (r"bring\s+the\s+original\s+certificate", 4),
            (r"room\s+108\s+for\s+verification", 3),
            (r"INTERNAL\s+MEMORANDUM", 2),
            (r"HR&D[-\s]*SNAS", 3),
        ],
        "is_form": True,
        "fields": [
            "ref_number", "date", "name", "department",
            "subject", "qualification",
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
# SHARED HELPERS FOR MEMO-FORMAT DOCUMENTS
# =============================================

def _extract_memo_name_and_dept(text: str) -> tuple:
    """Extract name and department from Internal Memorandum format.

    In templates, the layout is:
        TO: NAME
            DEPARTMENT
    In real filled documents, NAME and DEPARTMENT are replaced:
        TO: Mrs. Adeyemi
            Chemistry

    Returns (name, department) tuple where either may be None.
    """
    name = None
    department = None

    # Strategy 1: Positional — capture two lines after "TO:"
    to_block = re.search(
        r"TO[:\s]*\s*(.+?)\n\s*(.+?)(?:\n|$)", text, re.IGNORECASE
    )
    if to_block:
        line1 = to_block.group(1).strip()
        line2 = to_block.group(2).strip()

        # Line 1 is the name (skip if it's still the placeholder "NAME")
        if line1 and line1.upper() not in ("NAME", "") and len(line1) > 1:
            name = line1
        # Line 2 is the department (skip if it's still the placeholder)
        if line2 and line2.upper() not in ("DEPARTMENT", "") and len(line2) > 1:
            department = line2

    # Strategy 2: Fallback — look for labeled "DEPARTMENT:" format
    if not department:
        dept_match = re.search(
            r"(?:Department|DEPARTMENT)[,:\s]+(.+?)(?:\n|$)", text, re.IGNORECASE
        )
        if dept_match:
            val = dept_match.group(1).strip()
            if val and val.upper() not in ("DEPARTMENT", "") and len(val) > 1:
                department = val

    # Strategy 3: Fallback — look for labeled "TO:" without department on next line
    if not name:
        to_single = re.search(r"TO[:\s]*\s*(.+?)(?:\n|$)", text, re.IGNORECASE)
        if to_single:
            val = to_single.group(1).strip()
            if val and val.upper() not in ("NAME", "") and len(val) > 1:
                name = val

    return name, department


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
        fields["ref_number"] = ref.group(1).strip().split("\n")[0].strip().rstrip(".,;:") if hasattr(ref, 'group') else ref

    date = re.search(r"(?:Date|Dated?)[:\s]*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\d{1,2}\w*\s+\w+,?\s*\d{4}|\w+\s+\d{1,2},?\s*\d{4})", text, re.IGNORECASE)
    if date:
        fields["date"] = date.group(1).strip()

    # Try "Dear Mr/Mrs" pattern first
    name = re.search(r"Dear\s+(?:Mrs?\.?|Miss|Dr\.?)\s*,?\s*([A-Z][a-zA-Z\s\-\.]+?)(?:\n|,)", text)
    if not name:
        # Try NAME label
        name = re.search(r"^(?:NAME)\s*\n\s*(.+?)(?:\n|,)", text, re.MULTILINE)
    if name:
        val = name.group(1).strip()
        if val and val.upper() not in ("NAME", "DEPARTMENT", "DATE", "") and len(val) > 1:
            fields["name"] = val

    dept = re.search(r"(?:Department|DEPARTMENT)[,:\s]*\n?\s*(.+?)(?:\n|,)", text, re.IGNORECASE)
    if dept:
        val = dept.group(1).strip()
        if val and val.upper() not in ("DEPARTMENT", "NAME", "DATE", "") and len(val) > 1:
            fields["department"] = val

    meeting = re.search(r"meeting\s+of\s+(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\d{1,2}\w*\s+\w+,?\s*\d{4}|\w+\s+\d{1,2},?\s*\d{4})", text, re.IGNORECASE)
    if meeting:
        fields["meeting_date"] = meeting.group(1).strip()

    role = re.search(r"appointment\s+as\s+(.+?)\s+in\s+the", text, re.IGNORECASE)
    if role:
        val = role.group(1).strip().strip("_").strip()
        if val and val not in ("—", "–", "-", "_") and len(val) > 1:
            fields["appointment_role"] = val

    effective = re.search(r"effect\s+from\s+(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\d{1,2}\w*\s+\w+,?\s*\d{4}|\w+\s+\d{1,2},?\s*\d{4})", text, re.IGNORECASE)
    if effective:
        val = effective.group(1).strip().strip("_").strip()
        if val and val not in ("—", "–", "-", "_") and len(val) > 1:
            fields["effective_date"] = val

    return fields


def extract_assumption_fields(text: str) -> dict:
    """Extract fields from Assumption of Duty memo."""
    fields = {}
    ref = re.search(r"Ref\.?:?\s*(HR\s*[&8]\s*D[-\s]*SS/BUR/PF[.\w/]*)", text, re.IGNORECASE)
    if not ref:
        ref = _extract_ref_number(text)
    if ref:
        fields["ref_number"] = ref.group(1).strip().split("\n")[0].strip().rstrip(".,;:") if hasattr(ref, 'group') else ref

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
        fields["ref_number"] = ref.group(1).strip().split("\n")[0].strip().rstrip(".,;:") if hasattr(ref, 'group') else ref

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
        fields["ref_number"] = ref.group(1).strip().split("\n")[0].strip().rstrip(".,;:") if hasattr(ref, 'group') else ref

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


def extract_sdc_fields(text: str) -> dict:
    """Extract fields from Senior Staff Disciplinary Committee (Council Decision)."""
    fields = {}
    ref = re.search(r"Ref\.?\s*(?:No\.?)?\s*:?\s*(HR\s*[&8]\s*D[-\s]*SS/[.\w/]*PF[.\w/]*)", text, re.IGNORECASE)
    if not ref:
        ref = _extract_ref_number(text)
    if ref:
        fields["ref_number"] = ref.group(1).strip().split("\n")[0].strip().rstrip(".,;:") if hasattr(ref, 'group') else ref

    date = re.search(r"Date[:\s]*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\d{1,2}\w*\s+\w+,?\s*\d{4}|\w+\s+\d{1,2},?\s*\d{4})", text, re.IGNORECASE)
    if date:
        fields["date"] = date.group(1).strip()

    name = re.search(r"Dear\s+(?:Mrs?\.?|Miss|Dr\.?)\s*,?\s*([A-Z][a-zA-Z\s\-\.]+?)(?:\n|,)", text)
    if not name:
        name = re.search(r"^(?:Name)\s*[,:\s]*\n?\s*(.+?)(?:\n|,)", text, re.MULTILINE | re.IGNORECASE)
    if name:
        val = name.group(1).strip()
        if val and val.upper() not in ("NAME", "DEPARTMENT", "DATE", "") and len(val) > 1:
            fields["name"] = val

    dept = re.search(r"(?:Department|DEPARTMENT)[,:\s]*\n?\s*(.+?)(?:\n|,)", text, re.IGNORECASE)
    if dept:
        val = dept.group(1).strip()
        if val and val.upper() not in ("DEPARTMENT", "NAME", "") and len(val) > 1:
            fields["department"] = val

    meeting = re.search(r"meeting\s+held\s+on\s+(.+?)(?:,|\s+the\s+Governing)", text, re.IGNORECASE)
    if meeting:
        fields["meeting_date"] = meeting.group(1).strip().strip(".,").strip()

    decision = re.search(r"you\s+(?:are\s+)?hereby\s+(.+?)(?:\.|$)", text, re.IGNORECASE)
    if decision:
        val = decision.group(1).strip().strip("_. ").strip()
        if val and len(val) > 2:
            fields["council_decision"] = val

    return fields


def extract_co_name_fields(text: str) -> dict:
    """Extract fields from Change of Name memo."""
    fields = {}
    ref = re.search(r"(?:REF|Ref)\.?\s*:?\s*(HR\s*[&8]\s*D[-\s]*SNAS[/.\w]*)", text, re.IGNORECASE)
    if not ref:
        ref = _extract_ref_number(text)
    if ref:
        fields["ref_number"] = ref.group(1).strip().split("\n")[0].strip().rstrip(".,;:") if hasattr(ref, 'group') else ref

    date = re.search(r"DATE[:\s]*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\d{1,2}\w*\s+\w+,?\s*\d{4}|\w+\s+\d{1,2},?\s*\d{4})", text, re.IGNORECASE)
    if date:
        fields["date"] = date.group(1).strip()

    memo_name, memo_dept = _extract_memo_name_and_dept(text)
    if memo_name:
        fields["name"] = memo_name
    if memo_dept:
        fields["department"] = memo_dept

    name_from = re.search(r"From\s*:\s*(.+?)(?:\n|$)", text, re.IGNORECASE)
    if name_from:
        val = name_from.group(1).strip().strip("_-. ").strip()
        if val and len(val) > 1:
            fields["name_from"] = val

    name_to = re.search(r"\bTo\s*:\s*(.+?)(?:\n|$)", text, re.IGNORECASE)
    if name_to:
        val = name_to.group(1).strip().strip("_-. ").strip()
        if val and len(val) > 1:
            fields["name_to"] = val

    return fields


def extract_co_nok_fields(text: str) -> dict:
    """Extract fields from Change of Next-of-Kin memo."""
    fields = {}
    ref = re.search(r"(?:REF|Ref)\.?\s*:?\s*(HR\s*[&8]\s*D[-\s]*SNAS[/.\w]*)", text, re.IGNORECASE)
    if not ref:
        ref = _extract_ref_number(text)
    if ref:
        fields["ref_number"] = ref.group(1).strip().split("\n")[0].strip().rstrip(".,;:") if hasattr(ref, 'group') else ref

    date = re.search(r"DATE[:\s]*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\d{1,2}\w*\s+\w+,?\s*\d{4}|\w+\s+\d{1,2},?\s*\d{4})", text, re.IGNORECASE)
    if date:
        fields["date"] = date.group(1).strip()

    memo_name, memo_dept = _extract_memo_name_and_dept(text)
    if memo_name:
        fields["name"] = memo_name
    if memo_dept:
        fields["department"] = memo_dept

    from_match = re.search(r"From\s*:\s*\n?\s*1\.?\s*(.+?)(?:\n)", text, re.IGNORECASE)
    if from_match:
        val = from_match.group(1).strip().strip("_-. ").strip()
        if val and len(val) > 1:
            fields["nok_from"] = val

    to_match = re.search(r"\bTo\s*:\s*\n?\s*1\.?\s*(.+?)(?:\n)", text, re.IGNORECASE)
    if to_match:
        val = to_match.group(1).strip().strip("_-. ").strip()
        if val and len(val) > 1:
            fields["nok_to"] = val

    return fields


def extract_redeployment_fields(text: str) -> dict:
    """Extract fields from Redeployment letter."""
    fields = {}
    ref = re.search(r"(?:REF|Ref)\.?\s*(?:No\.?)?\s*:?\s*((?:REG/)?HR\s*[&8]\s*D[-\s]*SS[/.\w]*PF[/.\w]*)", text, re.IGNORECASE)
    if not ref:
        ref = _extract_ref_number(text)
    if ref:
        fields["ref_number"] = ref.group(1).strip().split("\n")[0].strip().rstrip(".,;:") if hasattr(ref, 'group') else ref

    date = re.search(r"Date[:\s]*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\d{1,2}\w*\s+\w+,?\s*\d{4}|\w+\s+\d{1,2},?\s*\d{4})", text, re.IGNORECASE)
    if date:
        fields["date"] = date.group(1).strip()

    name = re.search(r"Dear\s+(?:Mrs?\.?|Miss|Dr\.?)\s*,?\s*([A-Z][a-zA-Z\s\-\.]+?)(?:\n|,)", text)
    if not name:
        name = re.search(r"^(?:Name)\s*[,:\s]*\n?\s*(.+?)(?:\n|,)", text, re.MULTILINE | re.IGNORECASE)
    if name:
        val = name.group(1).strip()
        if val and val.upper() not in ("NAME", "DEPARTMENT", "") and len(val) > 1:
            fields["name"] = val

    dept = re.search(r"(?:Department|DEPARTMENT)[,:\s]*\n?\s*(.+?)(?:\n|,)", text, re.IGNORECASE)
    if dept:
        val = dept.group(1).strip()
        if val and val.upper() not in ("DEPARTMENT", "") and len(val) > 1:
            fields["department"] = val

    redeploy_from = re.search(r"redeployment\s+from\s+(?:your\s+)?(?:present\s+)?(?:schedule\s+)?(?:as\s+)?(.+?)\s+to\s+the", text, re.IGNORECASE)
    if redeploy_from:
        fields["redeployment_from"] = redeploy_from.group(1).strip().strip("_-. ").strip()

    redeploy_to = re.search(r"\bto\s+the\s+(.+?)(?:\s+with\s+effect|\s*\.|\s*,)", text, re.IGNORECASE)
    if redeploy_to:
        val = redeploy_to.group(1).strip().strip("_-. ").strip()
        if val and len(val) > 1:
            fields["redeployment_to"] = val

    effective = re.search(r"(?:with\s+)?effect\s+from\s+(.+?)(?:\.|,|\n)", text, re.IGNORECASE)
    if effective:
        val = effective.group(1).strip().strip("_-. ").strip()
        if val and len(val) > 1:
            fields["effective_date"] = val

    return fields


def extract_maternity_leave_fields(text: str) -> dict:
    """Extract fields from Maternity Leave memo."""
    fields = {}
    ref = re.search(r"(?:REF|Ref)\.?\s*:?\s*(HR\s*[&8]\s*D[-\s]*SNAS[/.\w]*)", text, re.IGNORECASE)
    if not ref:
        ref = _extract_ref_number(text)
    if ref:
        fields["ref_number"] = ref.group(1).strip().split("\n")[0].strip().rstrip(".,;:") if hasattr(ref, 'group') else ref

    date = re.search(r"DATE[:\s]*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\d{1,2}\w*\s+\w+,?\s*\d{4}|\w+\s+\d{1,2},?\s*\d{4})", text, re.IGNORECASE)
    if date:
        fields["date"] = date.group(1).strip()

    memo_name, memo_dept = _extract_memo_name_and_dept(text)
    if memo_name:
        fields["name"] = memo_name
    if memo_dept:
        fields["department"] = memo_dept

    leave_start = re.search(r"(?:with\s+)?effect\s+from\s+(.+?)(?:\.|,|\n)", text, re.IGNORECASE)
    if leave_start:
        val = leave_start.group(1).strip().strip("_-. ").strip()
        if val and len(val) > 1:
            fields["leave_start"] = val

    duration = re.search(r"(\w+\s+hundred\s+and\s+\w+\s*\(\d+\)\s*calendar\s*day)", text, re.IGNORECASE)
    if duration:
        fields["leave_duration"] = duration.group(1).strip()

    resume = re.search(r"resume\s+duty\s+in\s+your\s+Department\s+on\s+(.+?)(?:\.|,|\n)", text, re.IGNORECASE)
    if resume:
        val = resume.group(1).strip().strip("_-. ").strip()
        if val and len(val) > 1:
            fields["resume_date"] = val

    return fields


def extract_deferment_fields(text: str) -> dict:
    """Extract fields from Deferment of Leave memo."""
    fields = {}
    ref = re.search(r"(?:REF|Ref)\.?\s*:?\s*(HR\s*[&8]\s*D[-\s]*SNAS[/.\w]*)", text, re.IGNORECASE)
    if not ref:
        ref = _extract_ref_number(text)
    if ref:
        fields["ref_number"] = ref.group(1).strip().split("\n")[0].strip().rstrip(".,;:") if hasattr(ref, 'group') else ref

    date = re.search(r"DATE[:\s]*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\d{1,2}\w*\s+\w+,?\s*\d{4}|\w+\s+\d{1,2},?\s*\d{4})", text, re.IGNORECASE)
    if date:
        fields["date"] = date.group(1).strip()

    memo_name, memo_dept = _extract_memo_name_and_dept(text)
    if memo_name:
        fields["name"] = memo_name
    if memo_dept:
        fields["department"] = memo_dept

    subject = re.search(r"RE[:\s]*(.+?)(?:\n)", text, re.IGNORECASE)
    if subject:
        val = subject.group(1).strip().strip("_-. ").strip()
        if val and len(val) > 1:
            fields["subject"] = val

    days = re.search(r"annual\s+leave\s+of\s+[-_]*(\d+)[-_]*\s*working\s+days", text, re.IGNORECASE)
    if not days:
        days = re.search(r"leave\s+of\s+[-_]*\s*(\d+)\s*[-_]*\s*working\s+days", text, re.IGNORECASE)
    if days:
        fields["leave_days"] = days.group(1).strip()

    return fields


def extract_extension_probationary_fields(text: str) -> dict:
    """Extract fields from Extension of Probationary Appointment memo."""
    fields = {}
    ref = re.search(r"(?:Ref|REF)\.?\s*:?\s*(HR\s*[&8]\s*D[-\s]*SS[/.\w]*)", text, re.IGNORECASE)
    if not ref:
        ref = _extract_ref_number(text)
    if ref:
        fields["ref_number"] = ref.group(1).strip().split("\n")[0].strip().rstrip(".,;:") if hasattr(ref, 'group') else ref

    date = re.search(r"Date[:\s]*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\d{1,2}\w*\s+\w+,?\s*\d{4}|\w+\s+\d{1,2},?\s*\d{4})", text, re.IGNORECASE)
    if date:
        fields["date"] = date.group(1).strip()

    name = re.search(r"TO[:\s]*\s*(.+?)(?:\n|$)", text, re.IGNORECASE)
    if name:
        val = name.group(1).strip()
        if val and val.upper() not in ("BURSAR", "") and len(val) > 1:
            fields["name"] = val

    dept = re.search(r"in\s+the\s+[-_]*\s*(.+?)\s*[-_]*\s*Department", text, re.IGNORECASE)
    if dept:
        val = dept.group(1).strip().strip("_-. ").strip()
        if val and len(val) > 1:
            fields["department"] = val

    designation = re.search(r"appointment\s+of\s+[-_]*\s*(.+?)\s*[-_]*\s*in\s+the", text, re.IGNORECASE)
    if designation:
        val = designation.group(1).strip().strip("_-. ").strip()
        if val and len(val) > 1:
            fields["designation"] = val

    assumption = re.search(r"Date\s+of\s+Assumption\s+of\s+Duty[:\s]*(.+?)(?:\n|\|)", text, re.IGNORECASE)
    if assumption:
        val = assumption.group(1).strip().strip("_-. ").strip()
        if val and len(val) > 1:
            fields["assumption_date"] = val

    ext_from = re.search(r"Extension\s+with\s+Effect\s+from[:\s]*(.+?)(?:\n|\|)", text, re.IGNORECASE)
    if ext_from:
        val = ext_from.group(1).strip().strip("_-. ").strip()
        if val and len(val) > 1:
            fields["extension_from"] = val

    return fields


def extract_leave_approval_fields(text: str) -> dict:
    """Extract fields from Leave Approval memo."""
    fields = {}
    ref = re.search(r"(?:REF|Ref)\.?\s*:?\s*(HR\s*[&8]\s*D[-\s]*SNAS[/.\w]*)", text, re.IGNORECASE)
    if not ref:
        ref = _extract_ref_number(text)
    if ref:
        fields["ref_number"] = ref.group(1).strip().split("\n")[0].strip().rstrip(".,;:") if hasattr(ref, 'group') else ref

    date = re.search(r"DATE[:\s]*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\d{1,2}\w*\s+\w+,?\s*\d{4}|\w+\s+\d{1,2},?\s*\d{4})", text, re.IGNORECASE)
    if date:
        fields["date"] = date.group(1).strip()

    memo_name, memo_dept = _extract_memo_name_and_dept(text)
    if memo_name:
        fields["name"] = memo_name
    if memo_dept:
        fields["department"] = memo_dept

    subject = re.search(r"RE[:\s]*(.+?)(?:\n)", text, re.IGNORECASE)
    if subject:
        val = subject.group(1).strip().strip("_-. ").strip()
        if val and len(val) > 1:
            fields["subject"] = val

    days = re.search(r"utilize\s+[-_]*\s*(\d+)\s*[-_]*\s*working\s+days", text, re.IGNORECASE)
    if not days:
        days = re.search(r"[-_]*\s*(\d+)\s*[-_]*\s*working\s+days", text, re.IGNORECASE)
    if days:
        fields["leave_days"] = days.group(1).strip()

    leave_start = re.search(r"(?:with\s+)?effect\s+from\s+[-_]*\s*(.+?)\s*[-_]*\s*(?:working|,|\n)", text, re.IGNORECASE)
    if leave_start:
        val = leave_start.group(1).strip().strip("_-. ").strip()
        if val and len(val) > 1:
            fields["leave_start"] = val

    resume = re.search(r"resume\s+duty\s+in\s+your\s+office\s+on\s+(.+?)(?:\.|,|\n)", text, re.IGNORECASE)
    if resume:
        val = resume.group(1).strip().strip("_-. ").strip()
        if val and len(val) > 1:
            fields["resume_date"] = val

    return fields


def extract_ac_of_leave_fields(text: str) -> dict:
    """Extract fields from Accumulated Leave memo."""
    fields = {}
    ref = re.search(r"(?:REF|Ref)\.?\s*:?\s*(HR\s*[&8]\s*D[/\s]*SNAS[/.\w]*)", text, re.IGNORECASE)
    if not ref:
        ref = _extract_ref_number(text)
    if ref:
        fields["ref_number"] = ref.group(1).strip().split("\n")[0].strip().rstrip(".,;:") if hasattr(ref, 'group') else ref

    date = re.search(r"DATE[:\s]*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\d{1,2}\w*\s+\w+,?\s*\d{4}|\w+\s+\d{1,2},?\s*\d{4})", text, re.IGNORECASE)
    if date:
        fields["date"] = date.group(1).strip()

    memo_name, memo_dept = _extract_memo_name_and_dept(text)
    if memo_name:
        fields["name"] = memo_name
    if memo_dept:
        fields["department"] = memo_dept

    subject = re.search(r"RE[:\s]*(.+?)(?:\n)", text, re.IGNORECASE)
    if subject:
        val = subject.group(1).strip().strip("_-. ").strip()
        if val and len(val) > 1:
            fields["subject"] = val

    total = re.search(r"TOTAL\s*\|?\s*(\d+)", text, re.IGNORECASE)
    if total:
        fields["total_days"] = total.group(1).strip()

    return fields


def extract_appraisal_fields(text: str) -> dict:
    """Extract fields from Appraisal / Certificate Acknowledgement memo."""
    fields = {}
    ref = re.search(r"(?:REF|Ref)\.?\s*:?\s*(HR\s*[&8]\s*D[-\s]*SNAS[/.\w]*)", text, re.IGNORECASE)
    if not ref:
        ref = _extract_ref_number(text)
    if ref:
        fields["ref_number"] = ref.group(1).strip().split("\n")[0].strip().rstrip(".,;:") if hasattr(ref, 'group') else ref

    date = re.search(r"DATE[:\s]*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\d{1,2}\w*\s+\w+,?\s*\d{4}|\w+\s+\d{1,2},?\s*\d{4})", text, re.IGNORECASE)
    if date:
        fields["date"] = date.group(1).strip()

    memo_name, memo_dept = _extract_memo_name_and_dept(text)
    if memo_name:
        fields["name"] = memo_name
    if memo_dept:
        fields["department"] = memo_dept

    subject = re.search(r"RE[:\s]*(.+?)(?:\n)", text, re.IGNORECASE)
    if subject:
        val = subject.group(1).strip().strip("_-. ").strip()
        if val and len(val) > 1:
            fields["subject"] = val

    qual = re.search(r"successful\s+completion\s+of\s+[-_]*\s*(.+?)\s*[-_]*\s*(?:as\s+approved|,|\n)", text, re.IGNORECASE)
    if qual:
        val = qual.group(1).strip().strip("_-. ").strip()
        if val and len(val) > 1:
            fields["qualification"] = val

    return fields


# Map type to extraction function
EXTRACTORS = {
    "confirmation_of_appointment": extract_confirmation_fields,
    "assumption_of_duty": extract_assumption_fields,
    "promotion_exercise": extract_promotion_fields,
    "posting": extract_posting_fields,
    "SDC": extract_sdc_fields,
    "co_name": extract_co_name_fields,
    "co_next_of_kin": extract_co_nok_fields,
    "redeployment": extract_redeployment_fields,
    "maternity_leave": extract_maternity_leave_fields,
    "deferment": extract_deferment_fields,
    "extension_of_probationary": extract_extension_probationary_fields,
    "leave_approval": extract_leave_approval_fields,
    "ac_of_leave": extract_ac_of_leave_fields,
    "appraisal": extract_appraisal_fields,
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
