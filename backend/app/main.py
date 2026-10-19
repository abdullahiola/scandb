import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.services.classifier import DOCUMENT_TYPES
from app.routes import scan, staff, documents, export, batch

# =============================================
# APP SETUP
# =============================================

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

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
app.include_router(batch.router)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "ai_enabled": bool(GEMINI_API_KEY),
        "document_types": list(DOCUMENT_TYPES.keys()),
    }
