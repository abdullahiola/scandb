"use client";

import { useState, useRef, useEffect, useCallback } from "react";

type AppState = "camera" | "preview" | "processing" | "results";

interface ParsedField {
  key: string;
  value: string;
}

const API = process.env.NEXT_PUBLIC_API_URL || "";

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [state, setState] = useState<AppState>("camera");
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showFlash, setShowFlash] = useState(false);

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

  // === Camera ===
  const startCamera = useCallback(async (facing: "environment" | "user" = "environment") => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraReady(false);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          setCameraReady(true);
          setCameraError(false);
        };
      }
    } catch {
      setCameraError(true);
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  useEffect(() => {
    startCamera(facingMode);
    return () => stopCamera();
  }, []);

  const flipCamera = () => {
    const next = facingMode === "environment" ? "user" : "environment";
    setFacingMode(next);
    startCamera(next);
  };

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    setShowFlash(true);
    setTimeout(() => setShowFlash(false), 300);
    canvas.toBlob(blob => {
      if (!blob) return;
      const f = new File([blob], `scan_${Date.now()}.jpg`, { type: "image/jpeg" });
      setFile(f);
      setPreviewUrl(canvas.toDataURL("image/jpeg", 0.92));
      setState("preview");
      stopCamera();
    }, "image/jpeg", 0.92);
  }, [stopCamera]);

  // === File upload ===
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = "";
    stopCamera();
    setFile(f);

    if (f.type === "application/pdf") {
      // For PDFs, just use file icon as preview
      setPreviewUrl(null);
    } else {
      setPreviewUrl(URL.createObjectURL(f));
    }
    setState("preview");
  };

  // === Process via FastAPI ===
  const startScan = async () => {
    if (!file) return;
    setState("processing");
    setProgress(10);
    setStatusText("Uploading...");

    try {
      const formData = new FormData();
      formData.append("file", file);

      setProgress(30);
      setStatusText("Processing document...");

      const res = await fetch(`${API}/scan`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Scan failed");
      }

      setProgress(80);
      setStatusText("Analyzing...");

      const data = await res.json();
      setRawText(data.raw_text || "");
      setConfidence(data.confidence || 0);
      setParseMethod(data.method || "regex");

      if (data.fields) {
        setParsedFields(
          Object.entries(data.fields)
            .filter(([, v]) => String(v).trim() !== "")
            .map(([k, v]) => ({ key: k, value: String(v) }))
        );
      }

      setProgress(100);
      setState("results");
    } catch (err: any) {
      showToast(err.message || "Scan failed — try again");
      setState("preview");
    }
  };

  const downloadDB = async () => {
    try {
      const fieldsObj: Record<string, string> = {};
      parsedFields.forEach(f => { fieldsObj[f.key] = f.value; });

      const params = new URLSearchParams({
        file_name: file?.name || "scan",
        raw_text: rawText,
        confidence: String(confidence),
        fields: JSON.stringify(fieldsObj),
      });

      const res = await fetch(`${API}/export?${params}`, { method: "POST" });
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
      showToast("Database exported");
    } catch {
      showToast("Export failed");
    }
  };

  const reset = () => {
    setState("camera");
    setFile(null);
    setPreviewUrl(null);
    setRawText("");
    setConfidence(0);
    setParsedFields([]);
    setParseMethod("");
    setShowRawText(false);
    setProgress(0);
    startCamera(facingMode);
  };

  const circumference = 2 * Math.PI * 32;

  return (
    <div className="app">
      <canvas ref={canvasRef} style={{ display: "none" }} />
      <input id="gallery-input" type="file" accept="image/*,.pdf,application/pdf"
        style={{ position: "fixed", top: "-9999px", left: "-9999px", opacity: 0 }}
        onChange={handleFileUpload}
      />
      {showFlash && <div className="flash-overlay" />}

      {/* ===== LIVE CAMERA ===== */}
      {state === "camera" && (
        <div className="camera-screen">
          {!cameraError ? (
            <>
              <video ref={videoRef} className="camera-feed" autoPlay playsInline muted />
              {cameraReady && (
                <div className="scan-frame">
                  <div className="corner tl" /><div className="corner tr" />
                  <div className="corner bl" /><div className="corner br" />
                  <div className="scan-line" />
                </div>
              )}
              {!cameraReady && (
                <div className="camera-loading">
                  <div className="loading-spinner" />
                  <span>Initializing camera...</span>
                </div>
              )}
            </>
          ) : (
            <div className="fallback-screen">
              <div className="fallback-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              </div>
              <h2 className="fallback-title">Camera Unavailable</h2>
              <p className="fallback-sub">Use the options below to scan your document</p>
              <div className="fallback-actions">
                <label className="action-card">
                  <input type="file" accept="image/*,.pdf,application/pdf" capture="environment" onChange={handleFileUpload} />
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                  <div className="action-card-info">
                    <strong>Take Photo</strong>
                    <span>Opens your camera app</span>
                  </div>
                  <svg className="action-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
                </label>
                <label className="action-card">
                  <input type="file" accept="image/*,.pdf,application/pdf" onChange={handleFileUpload} />
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                  <div className="action-card-info">
                    <strong>Choose File</strong>
                    <span>Image or PDF</span>
                  </div>
                  <svg className="action-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
                </label>
              </div>
            </div>
          )}

          {!cameraError && (
            <div className="camera-bar">
              <label htmlFor="gallery-input" className="cam-btn">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              </label>
              <button className="shutter" onClick={capturePhoto} disabled={!cameraReady} aria-label="Capture" />
              <button className="cam-btn" onClick={flipCamera} disabled={!cameraReady}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ===== PREVIEW ===== */}
      {state === "preview" && (
        <div className="preview-screen">
          <div className="top-nav">
            <button className="nav-btn" onClick={reset}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </button>
            <span className="nav-title">Preview</span>
            <div style={{ width: 36 }} />
          </div>
          <div className="preview-area">
            {previewUrl ? (
              <img src={previewUrl} alt="Preview" className="preview-img" />
            ) : (
              <div className="pdf-placeholder">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                <span>{file?.name || "PDF Document"}</span>
              </div>
            )}
          </div>
          <div className="bottom-actions">
            <button className="btn btn-ghost" onClick={reset}>Retake</button>
            <button className="btn btn-primary" onClick={startScan}>Scan Document</button>
          </div>
        </div>
      )}

      {/* ===== PROCESSING ===== */}
      {state === "processing" && (
        <div className="preview-screen">
          <div className="preview-area">
            {previewUrl && <img src={previewUrl} alt="Scanning" className="preview-img" style={{ opacity: 0.25 }} />}
            <div className="processing-overlay">
              <div className="spinner-ring">
                <svg viewBox="0 0 72 72">
                  <circle className="track" cx="36" cy="36" r="32" />
                  <circle className="fill" cx="36" cy="36" r="32"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference * (1 - progress / 100)}
                  />
                </svg>
                <div className="spinner-pct">{progress}%</div>
              </div>
              <div className="spinner-label">{statusText}</div>
            </div>
          </div>
        </div>
      )}

      {/* ===== RESULTS ===== */}
      {state === "results" && (
        <div className="results-screen">
          <div className="results-image">
            <div className="top-nav overlay-nav">
              <button className="nav-btn" onClick={reset}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
              </button>
              <span className="nav-title">Results</span>
              <div style={{ width: 36 }} />
            </div>
            {previewUrl ? (
              <img src={previewUrl} alt="Scanned" className="preview-img" />
            ) : (
              <div className="pdf-placeholder dark">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <span>{file?.name}</span>
              </div>
            )}
          </div>

          <div className="results-sheet">
            <div className="sheet-handle" />
            <div className="sheet-section">
              <div className="sheet-title-row">
                <span className="sheet-title">Extracted Data</span>
                <span className="method-badge">{parseMethod === "ai" ? "AI Parsed" : "Auto Parsed"}</span>
              </div>

              <div className="confidence-card">
                <div className="conf-info">
                  <div className="conf-label">OCR Confidence</div>
                  <div className="conf-bar">
                    <div
                      className={`conf-bar-fill ${confidence >= 80 ? "high" : confidence >= 50 ? "mid" : "low"}`}
                      style={{ width: `${confidence}%` }}
                    />
                  </div>
                </div>
                <span className="conf-pct">{Math.round(confidence)}%</span>
              </div>

              {parsedFields.length > 0 && (
                <>
                  <div className="section-label">Detected Fields</div>
                  <div className="fields-grid">
                    {parsedFields.map((f, i) => (
                      <div key={i} className="field-item">
                        <span className="field-key">{f.key.replace(/_/g, " ")}</span>
                        <span className="field-val">{f.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <button className="raw-toggle" onClick={() => setShowRawText(!showRawText)}>
                <span>Raw OCR Text</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: showRawText ? "rotate(180deg)" : "none", transition: "transform 200ms" }}>
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </button>
              {showRawText && <pre className="raw-box">{rawText || "No text detected"}</pre>}
            </div>

            <div className="action-row">
              <button className="btn btn-success" onClick={downloadDB}>Export as .db</button>
              <button className="btn btn-ghost" onClick={reset}>New Scan</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
