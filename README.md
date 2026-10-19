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
| **AI Text Clean** | Google Gemini API (optional, free tier) |

## Features

- 📸 Camera capture or file upload (images + PDFs)
- 🔍 OCR text extraction with image preprocessing
- 📋 Automatic document classification (Confirmation, Assumption, Promotion, Posting)
- ✏️ Editable extracted fields
- 🧠 AI-powered text cleaning (optional, free Gemini API key)
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

#### 1. Create `.env` in the project root

```bash
# .env
GEMINI_API_KEY=your-gemini-api-key-here
```

#### 2. Build and run

```bash
docker compose up -d --build
```

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
| `GEMINI_API_KEY` | No | Root `.env` | Enables AI text cleaning/parsing (free key from [Google AI Studio](https://aistudio.google.com/apikey)) |
| `GEMINI_MODEL` | No | Root `.env` | Gemini model to use (default: `gemini-2.5-flash`; use `gemini-2.5-flash-lite` for higher free-tier limits) |

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
