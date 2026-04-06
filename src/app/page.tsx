"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createWorker, Worker } from "tesseract.js";

type AppState = "camera" | "preview" | "processing" | "results";

interface ParsedField {
  key: string;
  value: string;
}

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

  // === Capture from live camera ===
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

  // === File upload (gallery or native camera fallback) ===
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = "";
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setState("preview");
    stopCamera();
  };

  // === OCR ===
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
            setStatusText("Loading language data...");
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
        body: JSON.stringify({ fileName: file?.name || "scan", rawText, confidence, fields: parsedFields }),
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
    setState("camera");
    setFile(null);
    setPreviewUrl(null);
    setRawText("");
    setConfidence(0);
    setParsedFields([]);
    setShowRawText(false);
    setProgress(0);
    startCamera(facingMode);
  };

  const circumference = 2 * Math.PI * 32;

  return (
    <div className="app">
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* Hidden inputs for fallback / gallery */}
      <input id="gallery-input" type="file" accept="image/*"
        style={{ position: "fixed", top: "-9999px", left: "-9999px", opacity: 0 }}
        onChange={handleFileUpload}
      />
      <input id="native-camera" type="file" accept="image/*" capture="environment"
        style={{ position: "fixed", top: "-9999px", left: "-9999px", opacity: 0 }}
        onChange={handleFileUpload}
      />

      {showFlash && <div className="flash-overlay" />}

      {/* ===== CAMERA ===== */}
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
                  <span>Starting camera...</span>
                </div>
              )}
            </>
          ) : (
            /* Fallback when camera is blocked */
            <div className="fallback-screen">
              <div className="hero-icon">📷</div>
              <h2 className="hero-title">Scan Document</h2>
              <p className="hero-subtitle">Camera unavailable — use the options below</p>
              <div className="fallback-actions">
                <label className="action-card">
                  <input type="file" accept="image/*" capture="environment" onChange={handleFileUpload} />
                  <div className="action-card-icon camera">📸</div>
                  <div className="action-card-text">
                    <h3>Take Photo</h3>
                    <p>Opens your camera app</p>
                  </div>
                  <span className="action-card-arrow">›</span>
                </label>
                <label className="action-card">
                  <input type="file" accept="image/*" onChange={handleFileUpload} />
                  <div className="action-card-icon gallery">🖼️</div>
                  <div className="action-card-text">
                    <h3>Choose from Gallery</h3>
                    <p>Pick an existing photo</p>
                  </div>
                  <span className="action-card-arrow">›</span>
                </label>
              </div>
            </div>
          )}

          {/* Bottom bar — only when camera is live */}
          {!cameraError && (
            <div className="camera-bar">
              <label htmlFor="gallery-input" className="cam-btn small">🖼️</label>
              <button className="shutter" onClick={capturePhoto} disabled={!cameraReady} aria-label="Capture" />
              <button className="cam-btn small" onClick={flipCamera} disabled={!cameraReady}>🔄</button>
            </div>
          )}
        </div>
      )}

      {/* ===== PREVIEW ===== */}
      {state === "preview" && (
        <div className="preview-screen">
          <div className="preview-header">
            <button className="back-btn" onClick={reset}>←</button>
            <span className="preview-label">Preview</span>
            <div style={{ width: 36 }} />
          </div>
          <div className="preview-area">
            {previewUrl && <img src={previewUrl} alt="Preview" className="preview-img" />}
          </div>
          <div className="preview-bar">
            <button className="btn btn-ghost" onClick={reset}>Retake</button>
            <button className="btn btn-primary" onClick={startOCR}>⚡ Scan Document</button>
          </div>
        </div>
      )}

      {/* ===== PROCESSING ===== */}
      {state === "processing" && (
        <div className="preview-screen">
          <div className="preview-area">
            {previewUrl && <img src={previewUrl} alt="Scanning" className="preview-img" style={{ opacity: 0.3 }} />}
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
            <div className="preview-header">
              <button className="back-btn" onClick={reset}>←</button>
              <span className="preview-label">Results</span>
              <div style={{ width: 36 }} />
            </div>
            {previewUrl && <img src={previewUrl} alt="Scanned" className="preview-img" />}
          </div>

          <div className="results-sheet">
            <div className="sheet-handle" />
            <div className="sheet-section">
              <div className="sheet-title-row">
                <span className="sheet-title">Extracted Data</span>
                <span className="method-badge">{parseMethod === "ai" ? "🤖 AI" : "📐 Auto"}</span>
              </div>

              <div className="confidence-card">
                <span className="conf-icon">{confidence >= 80 ? "🎯" : confidence >= 50 ? "⚠️" : "❌"}</span>
                <div className="conf-info">
                  <div className="conf-label">Accuracy</div>
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
                  <div className="fields-title">📊 Fields</div>
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
                <span>📝 Raw Text</span>
                <span>{showRawText ? "▲" : "▼"}</span>
              </button>
              {showRawText && <pre className="raw-box">{rawText || "No text detected"}</pre>}
            </div>

            <div className="action-row">
              <button className="btn btn-success" onClick={downloadDB}>💾 Download .db</button>
              <button className="btn btn-ghost" onClick={reset}>📷 New Scan</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">✨ {toast}</div>}
    </div>
  );
}
