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

  // === PDF to image ===
  const convertPdfToImage = async (pdfFile: File): Promise<{ file: File; url: string }> => {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);
    const scale = 2;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
    const dataUrl = canvas.toDataURL("image/png");
    const blob = await (await fetch(dataUrl)).blob();
    const imgFile = new File([blob], pdfFile.name.replace(".pdf", ".png"), { type: "image/png" });
    return { file: imgFile, url: dataUrl };
  };

  // === File upload ===
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = "";
    stopCamera();

    if (f.type === "application/pdf") {
      setState("processing");
      setProgress(0);
      setStatusText("Converting PDF...");
      try {
        const { file: imgFile, url } = await convertPdfToImage(f);
        setFile(imgFile);
        setPreviewUrl(url);
        setState("preview");
      } catch (err) {
        console.error("PDF error:", err);
        showToast("Failed to convert PDF");
        setState("camera");
        startCamera(facingMode);
      }
    } else {
      setFile(f);
      setPreviewUrl(URL.createObjectURL(f));
      setState("preview");
    }
  };

  // === OCR ===
  const startOCR = async () => {
    if (!file) return;
    setState("processing");
    setProgress(0);
    setStatusText("Initializing...");

    let worker: Worker | null = null;
    try {
      worker = await createWorker("eng", undefined, {
        logger: (m: { status: string; progress: number }) => {
          if (m.status === "recognizing text") {
            setProgress(Math.round(m.progress * 90));
            setStatusText("Reading document...");
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
      setStatusText("Analyzing fields...");
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
      showToast("Database exported successfully");
    } catch {
      showToast("Export failed — please retry");
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
      <input id="gallery-input" type="file" accept="image/*,.pdf,application/pdf"
        style={{ position: "fixed", top: "-9999px", left: "-9999px", opacity: 0 }}
        onChange={handleFileUpload}
      />
      <input id="native-camera" type="file" accept="image/*,.pdf,application/pdf" capture="environment"
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

          {/* Camera bottom bar */}
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
            {previewUrl && <img src={previewUrl} alt="Preview" className="preview-img" />}
          </div>
          <div className="bottom-actions">
            <button className="btn btn-ghost" onClick={reset}>Retake</button>
            <button className="btn btn-primary" onClick={startOCR}>Scan Document</button>
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
            {previewUrl && <img src={previewUrl} alt="Scanned" className="preview-img" />}
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
