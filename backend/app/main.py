import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.services.classifier import DOCUMENT_TYPES
from app.routes import scan, staff, documents, export

# =============================================
# APP SETUP
# =============================================

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

# Initialize database
init_db()

# Register routes
app.include_router(scan.router)
app.include_router(staff.router)
app.include_router(documents.router)
app.include_router(export.router)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "ai_enabled": bool(HAS_ANTHROPIC and ANTHROPIC_API_KEY),
        "document_types": list(DOCUMENT_TYPES.keys()),
    }
