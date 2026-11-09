# ScanDB — Scan to Database

A full-stack document scanning and staff records management system. Upload or capture documents, extract text via OCR, classify document types, and store structured staff records in a central repository.

## Architecture

```
scandb/
├── backend/           # Python FastAPI — OCR, classification, database
│   ├── app/
│   │   ├── main.py          # App entry point
│   │   ├── database.py      # SQLite init, helpers
│   │   ├── routes/          # API endpoints
│   │   │   ├── scan.py      # /scan, /scan-document
│   │   │   ├── staff.py     # /staff CRUD
│   │   │   ├── documents.py # Document update/delete
│   │   │   └── export.py    # DB export endpoints
│   │   ├── services/        # Business logic
│   │   │   ├── ocr.py       # PaddleOCR (PP-OCRv5) engine
│   │   │   └── classifier.py # Document type identification
│   │   └── utils/
│   │       └── fields.py    # Field extraction helpers
│   ├── data/                # SQLite database (auto-created)
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/          # Next.js — UI, proxies API calls to backend
│   ├── src/app/
│   │   ├── ScanApp.tsx      # Main scan interface
│   │   ├── repository/      # Staff repository dashboard
│   │   └── api/             # Proxy routes → backend
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml
└── .env
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 16, TypeScript |
| **Backend** | FastAPI, Python 3.11 |
| **OCR** | PaddleOCR (PP-OCRv5) |
| **PDF Processing** | PyMuPDF (fitz) |
| **Database** | SQLite3 |
| **AI Text Clean** | Local LLM via Ollama (Docker default) or Google Gemini API |

## Features

- 📸 Camera capture or file upload (images + PDFs)
- 🔍 OCR text extraction with image preprocessing
- 📋 Automatic document classification (Confirmation, Assumption, Promotion, Posting)
- ✏️ Editable extracted fields
- 🧠 AI-powered text cleaning (local Ollama model in Docker, or a free Gemini API key)
- 👥 Staff records with document management
- 📦 SQLite database export
- 🎨 Glassmorphism dark UI

---

## Getting Started

### Prerequisites

- **Python 3.11+** with `pip`
- **Node.js 20+** with `npm`
OCR is handled by **PaddleOCR** — installed automatically via `pip install -r requirements.txt`. Model files (~30MB) download on the first scan; the Docker image pre-downloads them at build time.

---

### Local Development

#### 1. Backend

```bash
cd backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate        # macOS/Linux
# venv\Scripts\activate         # Windows

# Install dependencies
pip install -r requirements.txt

# Run the backend
fastapi dev app/main.py
# or: python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Backend runs at **http://localhost:8000**

#### 2. Frontend

```bash
cd frontend

# Install dependencies
npm install

# Create .env file
echo 'BACKEND_URL="http://localhost:8000"' > .env

# Optional: add AI cleaning support
echo 'GEMINI_API_KEY="your-key-here"' >> .env   # free at https://aistudio.google.com/apikey

# Run the frontend
npm run dev
```

Frontend runs at **http://localhost:3000**

#### 3. Open in Browser

- **Scan Page:** http://localhost:3000
- **Repository:** http://localhost:3000/repository
- **API Health:** http://localhost:8000/health

---

### Docker Deployment

The compose file starts three services: the OCR backend, the frontend and an
**Ollama** container that serves a local LLM, so AI cleaning works with no API key.

#### 1. (Optional) Create `.env` in the project root

```bash
cp .env.example .env
```

Defaults work out of the box. Edit `.env` to pick a different model (`OLLAMA_MODEL`)
or to use Gemini instead (`GEMINI_API_KEY` + `LLM_PROVIDER=gemini`).

| VPS RAM | Suggested `OLLAMA_MODEL` |
|---------|--------------------------|
| 4 GB | `qwen2.5:3b-instruct` (default) |
| 8 GB | `qwen2.5:7b-instruct` |

#### 2. Build and run

```bash
docker compose up -d --build
```

The first start downloads the model (~2 GB for the default). The frontend waits
for the model to be ready; follow progress with `docker compose logs -f ollama`.

#### 3. Access

| Service | URL |
|---------|-----|
| Frontend | http://your-server:3001 |
| Repository | http://your-server:3001/repository |
| Backend API | http://your-server:8080/health |

#### Useful Docker commands

```bash
# View logs
docker compose logs -f

# Rebuild a specific service
docker compose up -d --build frontend
docker compose up -d --build backend

# Stop everything
docker compose down

# Check running containers
docker ps
```

---

## API Endpoints

### Scan
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/scan-document` | Smart scan — OCR + classify + extract fields |
| POST | `/scan` | Legacy scan — OCR + generic field extraction |

### Staff
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/staff` | List all staff with documents |
| POST | `/staff` | Create/find staff, save document |
| GET | `/staff/{id}` | Get single staff record |
| PATCH | `/staff/{id}` | Update staff name/department |
| DELETE | `/staff/{id}` | Delete staff + documents |

### Documents
| Method | Endpoint | Description |
|--------|----------|-------------|
| PATCH | `/staff/{id}/documents/{docId}` | Update document |
| DELETE | `/staff/{id}/documents/{docId}` | Delete document |

### Export
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/export-db` | Download full staff database |
| POST | `/export` | Export single scan as .db |

### Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Service status + AI availability |

---

## Environment Variables

| Variable | Required | Where | Description |
|----------|----------|-------|-------------|
| `BACKEND_URL` | Yes | Frontend `.env` | Backend API URL (default: `http://localhost:8000`) |
| `OLLAMA_URL` | No | Frontend env | Base URL of an Ollama server (set automatically by Docker Compose). Enables local AI cleaning/parsing |
| `OLLAMA_MODEL` | No | Root `.env` | Ollama model to pull and use (default: `qwen2.5:3b-instruct`) |
| `OLLAMA_MEMORY_LIMIT` | No | Root `.env` | Memory cap for the Ollama container (default: `6g`) |
| `OLLAMA_TIMEOUT_MS` | No | Root `.env` | Per-request timeout for the local model (default: `120000`) |
| `GEMINI_API_KEY` | No | Root `.env` | Enables Gemini-based AI cleaning/parsing (free key from [Google AI Studio](https://aistudio.google.com/apikey)) |
| `GEMINI_MODEL` | No | Root `.env` | Gemini model to use (default: `gemini-2.5-flash`; use `gemini-2.5-flash-lite` for higher free-tier limits) |
| `LLM_PROVIDER` | No | Root `.env` | `ollama` or `gemini`. Forces a provider when both are configured; otherwise Ollama wins if `OLLAMA_URL` is set |

---

## Document Types Supported

| Type | Label | Detected By |
|------|-------|-------------|
| `confirmation_of_appointment` | Confirmation of Appointment | Regex patterns |
| `assumption_of_duty` | Assumption of Duty | Regex patterns |
| `promotion_exercise` | Promotion Exercise | Regex patterns |
| `posting` | Posting | Regex patterns |

---

## License

MIT
