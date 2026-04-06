"use client";

import { useState } from "react";
import { createWorker, Worker } from "tesseract.js";

type AppState = "idle" | "preview" | "processing" | "results";

interface ParsedField {
  key: string;
  value: string;
}

export default function Home() {
  const [state, setState] = useState<AppState>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [rawText, setRawText] = useState("");
  const [confidence, setConfidence] = useState(0);
  const [parsedFields, setParsedFields] = useState<ParsedField[]>([]);
  const [parseMethod, setParseMethod] = useState("");
  const [showRawText, setShowRawText] = useState(false);

  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = ""; // allow re-select
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setState("preview");
  };

  const startOCR = async () => {
    if (!file) return;
    setState("processing");
    setProgress(0);
    setStatusText("Loading engine...");

    let worker: Worker | null = null;
    try {
      worker = await createWorker("eng", undefined, {
        logger: (m: { status: string; progress: number }) => {
          if (m.status === "recognizing text") {
            setProgress(Math.round(m.progress * 90));
            setStatusText("Scanning text...");
          } else if (m.status === "loading language traineddata") {
            setProgress(5);
            setStatusText("Loading...");
          }
        },
      });

      const { data } = await worker.recognize(file);
      setRawText(data.text);
      setConfidence(data.confidence);
      setProgress(95);
      setStatusText("Analyzing...");
      await worker.terminate();
      worker = null;

      await parseText(data.text);
      setProgress(100);
      setState("results");
    } catch (err) {
      console.error("OCR error:", err);
      showToast("Scan failed — try again");
      setState("preview");
      if (worker) try { await worker.terminate(); } catch { /* */ }
    }
  };

  const parseText = async (text: string) => {
    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: text, documentType: "invoice", fields: [] }),
      });
      const data = await res.json();
      if (data.parsed) {
        setParsedFields(
          Object.entries(data.parsed)
            .filter(([, v]) => String(v).trim() !== "")
            .map(([k, v]) => ({ key: k, value: String(v) }))
        );
        setParseMethod(data.method || "regex");
      }
    } catch {
      setParsedFields([]);
    }
  };

  const downloadDB = async () => {
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file?.name || "scan",
          rawText,
          confidence,
          fields: parsedFields,
        }),
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `scan_${Date.now()}.db`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("Database saved!");
    } catch {
      showToast("Download failed");
    }
  };

  const reset = () => {
    setState("idle");
    setFile(null);
    setPreviewUrl(null);
    setRawText("");
    setConfidence(0);
    setParsedFields([]);
    setShowRawText(false);
    setProgress(0);
  };

  return (
    <div className="app">

      {/* ===== IDLE: Camera-style capture screen ===== */}
      {state === "idle" && (
        <div className="capture-screen">
          {/* Viewfinder area */}
          <div className="viewfinder">
            <div className="scan-frame">
              <div className="corner tl" />
              <div className="corner tr" />
              <div className="corner bl" />
              <div className="corner br" />
            </div>
            <div className="viewfinder-text">Point at a document</div>
          </div>

          {/* Bottom controls */}
          <div className="capture-bar">
            {/* Gallery */}
            <label className="capture-circle small">
              <input type="file" accept="image/*" onChange={handleFile} />
              <span>🖼️</span>
            </label>

            {/* Shutter — opens native camera */}
            <label className="shutter-btn">
              <input type="file" accept="image/*" capture="environment" onChange={handleFile} />
            </label>

            {/* Spacer */}
            <div className="capture-circle small" style={{ visibility: "hidden" }}>
              <span>x</span>
            </div>
          </div>
        </div>
      )}

      {/* ===== PREVIEW ===== */}
      {state === "preview" && (
        <div className="preview-screen">
          <div className="preview-area">
            {previewUrl && <img src={previewUrl} alt="Preview" className="preview-img" />}
          </div>
          <div className="preview-bar">
            <button className="pill-btn outline" onClick={reset}>Retake</button>
            <button className="pill-btn primary" onClick={startOCR}>⚡ Scan Document</button>
          </div>
        </div>
      )}

      {/* ===== PROCESSING ===== */}
      {state === "processing" && (
        <div className="preview-screen">
          <div className="preview-area">
            {previewUrl && <img src={previewUrl} alt="Scanning" className="preview-img" style={{ opacity: 0.4 }} />}
            <div className="processing-overlay">
              <div className="processing-spinner" />
              <div className="processing-pct">{progress}%</div>
              <div className="processing-label">{statusText}</div>
            </div>
          </div>
        </div>
      )}

      {/* ===== RESULTS ===== */}
      {state === "results" && (
        <div className="results-screen">
          <div className="results-image-area">
            {previewUrl && <img src={previewUrl} alt="Scanned" className="preview-img" />}
          </div>

          <div className="results-sheet">
            <div className="sheet-handle" />

            <div className="sheet-header">
              <span className="sheet-title">Scan Results</span>
              <span className="sheet-badge">{parseMethod === "ai" ? "🤖 AI" : "📐 Auto"}</span>
            </div>

            <div className="sheet-body">
              {/* Confidence */}
              <div className="confidence-row">
                <span className="conf-label">Accuracy</span>
                <div className="conf-track">
                  <div
                    className={`conf-fill ${confidence >= 80 ? "high" : confidence >= 50 ? "mid" : "low"}`}
                    style={{ width: `${confidence}%` }}
                  />
                </div>
                <span className="conf-pct">{Math.round(confidence)}%</span>
              </div>

              {/* Fields */}
              {parsedFields.length > 0 && (
                <div className="fields">
                  {parsedFields.map((f, i) => (
                    <div key={i} className="field-row">
                      <span className="field-key">{f.key.replace(/_/g, " ")}</span>
                      <span className="field-val">{f.value}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Raw text */}
              <button className="raw-toggle" onClick={() => setShowRawText(!showRawText)}>
                📝 Raw Text {showRawText ? "▲" : "▼"}
              </button>
              {showRawText && <pre className="raw-box">{rawText || "No text"}</pre>}

              {/* Actions */}
              <div className="result-actions">
                <button className="pill-btn success" onClick={downloadDB}>💾 Download .db</button>
                <button className="pill-btn outline" onClick={reset}>📷 New Scan</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
