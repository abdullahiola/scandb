"use client";

import { useState, useRef, useEffect, useCallback } from "react";

type AppState = "camera" | "preview" | "processing" | "results" | "saved";

interface ParsedField {
  key: string;
  value: string;
  editable: boolean;
}

interface ScanResult {
  file: File;
  previewUrl: string | null;
  rawText: string;
  originalRawText: string;
  confidence: number;
  parsedFields: ParsedField[];
  parseMethod: string;
  documentType: string;
  documentLabel: string;
  typeConfidence: number;
  isForm: boolean;
  expectedFields: string[];
  cleanedText: string;
  aiCleaned: boolean;
  aiCleaning: boolean;
  showRawText: boolean;
  editMode: boolean;
}

interface StaffRecord {
  id: number;
  name: string;
  department: string;
  staffId: string;
  documents: StaffDocRecord[];
}

interface StaffDocRecord {
  id: number;
  documentType: string;
  documentLabel: string;
  fileName: string;
  status: string;
  createdAt: string;
}

// Document type icons
const DOC_TYPE_ICONS: Record<string, string> = {
  confirmation_of_appointment: "✅",
  assumption_of_duty: "📋",
  promotion_exercise: "🎉",
  posting: "📍",
  unknown: "📄",
};

const DOC_TYPE_COLORS: Record<string, string> = {
  confirmation_of_appointment: "#10b981",
  assumption_of_duty: "#3b82f6",
  promotion_exercise: "#f59e0b",
  posting: "#8b5cf6",
  unknown: "#6b7280",
};

export default function ScanApp() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [state, setState] = useState<AppState>("camera");
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [showFlash, setShowFlash] = useState(false);

  // Multi-file state
  const [files, setFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<(string | null)[]>([]);
  const [results, setResults] = useState<ScanResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  // Staff
  const [staffList, setStaffList] = useState<StaffRecord[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<StaffRecord | null>(null);
  const [saving, setSaving] = useState(false);

  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [processingIndex, setProcessingIndex] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // Fetch staff on mount
  useEffect(() => {
    fetchStaff();
  }, []);

  const fetchStaff = async () => {
    try {
      const res = await fetch("/api/staff");
      if (res.ok) {
        const data = await res.json();
        setStaffList(data.staff || []);
      }
    } catch { /* silent */ }
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
      setFiles([f]);
      setPreviewUrls([canvas.toDataURL("image/jpeg", 0.92)]);
      setState("preview");
      stopCamera();
    }, "image/jpeg", 0.92);
  }, [stopCamera]);

  // === File upload (multiple) ===
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    // Copy files BEFORE clearing input (clearing nullifies the live FileList)
    const newFiles = Array.from(fileList);
    e.target.value = "";
    stopCamera();
    const newPreviews = newFiles.map(f =>
      f.type === "application/pdf" ? null : URL.createObjectURL(f)
    );

    setFiles(prev => [...prev, ...newFiles]);
    setPreviewUrls(prev => [...prev, ...newPreviews]);
    setState("preview");
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
    setPreviewUrls(prev => {
      const url = prev[index];
      if (url) URL.revokeObjectURL(url);
      return prev.filter((_, i) => i !== index);
    });
    // If no files left, go back to camera
    if (files.length <= 1) {
      reset();
    }
  };

  // === Process all files via backend /scan-document ===
  const startScan = async () => {
    if (files.length === 0) return;
    setState("processing");
    setProcessingIndex(0);
    setProgress(0);
    setStatusText("Starting batch scan...");

    const allResults: ScanResult[] = [];
    const total = files.length;

    for (let i = 0; i < total; i++) {
      const file = files[i];
      const previewUrl = previewUrls[i];
      setProcessingIndex(i);

      try {
        // Calculate progress for this file within the batch
        const fileBaseProgress = (i / total) * 100;
        const fileProgressRange = 100 / total;

        setProgress(Math.round(fileBaseProgress + fileProgressRange * 0.1));
        setStatusText(`Uploading ${file.name}... (${i + 1}/${total})`);

        const formData = new FormData();
        formData.append("file", file);

        setProgress(Math.round(fileBaseProgress + fileProgressRange * 0.25));
        setStatusText(`Running OCR on ${file.name}... (${i + 1}/${total})`);

        const res = await fetch(`/api/scan-document`, {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Scan failed");
        }

        setProgress(Math.round(fileBaseProgress + fileProgressRange * 0.6));
        setStatusText(`Identifying ${file.name}... (${i + 1}/${total})`);

        const data = await res.json();

        await new Promise(r => setTimeout(r, 200));
        setProgress(Math.round(fileBaseProgress + fileProgressRange * 0.8));
        setStatusText(`Extracting fields from ${file.name}... (${i + 1}/${total})`);

        // Build editable fields list
        const fields: ParsedField[] = [];
        const extractedKeys = new Set<string>();

        if (data.fields) {
          Object.entries(data.fields)
            .filter(([, v]) => String(v).trim() !== "")
            .forEach(([k, v]) => {
              fields.push({ key: k, value: String(v), editable: true });
              extractedKeys.add(k);
            });
        }

        if (data.expected_fields) {
          for (const field of data.expected_fields) {
            if (!extractedKeys.has(field)) {
              fields.push({ key: field, value: "", editable: true });
            }
          }
        }

        allResults.push({
          file,
          previewUrl,
          rawText: data.raw_text || "",
          originalRawText: data.raw_text || "",
          confidence: data.confidence || 0,
          parsedFields: fields,
          parseMethod: data.method || "regex",
          documentType: data.document_type || "unknown",
          documentLabel: data.document_label || "Unknown Document",
          typeConfidence: data.type_confidence || 0,
          isForm: data.is_form || false,
          expectedFields: data.expected_fields || [],
          cleanedText: "",
          aiCleaned: false,
          aiCleaning: false,
          showRawText: false,
          editMode: data.is_form || false,
        });

        setProgress(Math.round(fileBaseProgress + fileProgressRange));
      } catch (err: any) {
        // Add a failed result placeholder
        allResults.push({
          file,
          previewUrl,
          rawText: `Error: ${err.message || "Scan failed"}`,
          originalRawText: "",
          confidence: 0,
          parsedFields: [],
          parseMethod: "",
          documentType: "unknown",
          documentLabel: `Failed: ${file.name}`,
          typeConfidence: 0,
          isForm: false,
          expectedFields: [],
          cleanedText: "",
          aiCleaned: false,
          aiCleaning: false,
          showRawText: false,
          editMode: false,
        });
      }
    }

    setResults(allResults);
    setActiveIndex(0);
    setProgress(100);
    setStatusText("All documents processed!");

    await new Promise(r => setTimeout(r, 500));
    setState("results");
  };

  // Current active result helpers
  const activeResult = results[activeIndex];

  const updateResultField = (resultIndex: number, fieldIndex: number, value: string) => {
    setResults(prev =>
      prev.map((r, ri) =>
        ri === resultIndex
          ? {
              ...r,
              parsedFields: r.parsedFields.map((f, fi) =>
                fi === fieldIndex ? { ...f, value } : f
              ),
            }
          : r
      )
    );
  };

  const toggleResultEditMode = (resultIndex: number) => {
    setResults(prev =>
      prev.map((r, ri) =>
        ri === resultIndex ? { ...r, editMode: !r.editMode } : r
      )
    );
  };

  const toggleResultRawText = (resultIndex: number) => {
    setResults(prev =>
      prev.map((r, ri) =>
        ri === resultIndex ? { ...r, showRawText: !r.showRawText } : r
      )
    );
  };

  // === AI Clean per result ===
  const handleAiClean = async (resultIndex: number) => {
    const result = results[resultIndex];

    if (result.aiCleaned) {
      // Toggle back to original
      setResults(prev =>
        prev.map((r, ri) =>
          ri === resultIndex ? { ...r, rawText: r.originalRawText, aiCleaned: false } : r
        )
      );
      return;
    }

    if (result.cleanedText) {
      setResults(prev =>
        prev.map((r, ri) =>
          ri === resultIndex ? { ...r, rawText: r.cleanedText, aiCleaned: true } : r
        )
      );
      return;
    }

    // Set loading
    setResults(prev =>
      prev.map((r, ri) =>
        ri === resultIndex ? { ...r, aiCleaning: true } : r
      )
    );

    try {
      const res = await fetch("/api/ai-clean", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: result.originalRawText }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "AI cleaning failed");
      }

      const data = await res.json();
      setResults(prev =>
        prev.map((r, ri) =>
          ri === resultIndex
            ? { ...r, cleanedText: data.cleanedText, rawText: data.cleanedText, aiCleaned: true, aiCleaning: false }
            : r
        )
      );
      showToast("Text cleaned with AI ✨");
    } catch (err: any) {
      showToast(err.message || "AI cleaning failed");
      setResults(prev =>
        prev.map((r, ri) =>
          ri === resultIndex ? { ...r, aiCleaning: false } : r
        )
      );
    }
  };

  // === Save current document to Staff ===
  const saveToStaff = async () => {
    if (!activeResult) return;
    setSaving(true);

    try {
      const nameField = activeResult.parsedFields.find(f => f.key === "name");
      const deptField = activeResult.parsedFields.find(f => f.key === "department");
      const refField = activeResult.parsedFields.find(f => f.key === "ref_number");

      const staffName = nameField?.value?.trim() || "Unknown Staff";
      const department = deptField?.value?.trim() || "";

      const extractedData: Record<string, string> = {};
      activeResult.parsedFields.forEach(f => {
        if (f.value.trim()) extractedData[f.key] = f.value;
      });

      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: staffName,
          department,
          staffId: refField?.value || "",
          document: {
            documentType: activeResult.documentType,
            documentLabel: activeResult.documentLabel,
            fileName: activeResult.file?.name || "scan",
            rawText: activeResult.rawText,
            extractedData,
            fullContent: activeResult.rawText,
            confidence: activeResult.confidence,
            isForm: activeResult.isForm,
          },
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Save failed");
      }

      const data = await res.json();
      setSelectedStaff(data.staff);
      await fetchStaff();

      // If only one result or last result, go to saved screen
      if (results.length === 1) {
        setState("saved");
      }
      showToast(`Document saved to staff record!`);
    } catch (err: any) {
      showToast(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // === Save all documents ===
  const saveAllToStaff = async () => {
    setSaving(true);
    let savedCount = 0;

    for (const result of results) {
      try {
        const nameField = result.parsedFields.find(f => f.key === "name");
        const deptField = result.parsedFields.find(f => f.key === "department");
        const refField = result.parsedFields.find(f => f.key === "ref_number");

        const staffName = nameField?.value?.trim() || "Unknown Staff";
        const department = deptField?.value?.trim() || "";

        const extractedData: Record<string, string> = {};
        result.parsedFields.forEach(f => {
          if (f.value.trim()) extractedData[f.key] = f.value;
        });

        const res = await fetch("/api/staff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: staffName,
            department,
            staffId: refField?.value || "",
            document: {
              documentType: result.documentType,
              documentLabel: result.documentLabel,
              fileName: result.file?.name || "scan",
              rawText: result.rawText,
              extractedData,
              fullContent: result.rawText,
              confidence: result.confidence,
              isForm: result.isForm,
            },
          }),
        });

        if (res.ok) {
          const data = await res.json();
          setSelectedStaff(data.staff);
          savedCount++;
        }
      } catch { /* continue */ }
    }

    await fetchStaff();
    showToast(`${savedCount}/${results.length} documents saved!`);
    if (savedCount > 0) setState("saved");
    setSaving(false);
  };

  const downloadDB = async () => {
    if (!activeResult) return;
    try {
      const fieldsObj: Record<string, string> = {};
      activeResult.parsedFields.forEach(f => { fieldsObj[f.key] = f.value; });

      const res = await fetch(`/api/export-db`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_name: activeResult.file?.name || "scan",
          raw_text: activeResult.rawText,
          confidence: activeResult.confidence,
          fields: fieldsObj,
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
      showToast("Database exported");
    } catch {
      showToast("Export failed");
    }
  };

  const reset = () => {
    setState("camera");
    setFiles([]);
    setPreviewUrls([]);
    setResults([]);
    setActiveIndex(0);
    setSelectedStaff(null);
    setProgress(0);
    setProcessingIndex(0);
    startCamera(facingMode);
  };

  const circumference = 2 * Math.PI * 32;
  const totalSize = files.reduce((acc, f) => acc + f.size, 0);

  return (
    <div className="app">
      <canvas ref={canvasRef} style={{ display: "none" }} />
      <input id="gallery-input" type="file" accept="image/*,.pdf,application/pdf" multiple
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
                  <input type="file" accept="image/*,.pdf,application/pdf" multiple onChange={handleFileUpload} />
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                  <div className="action-card-info">
                    <strong>Choose Files</strong>
                    <span>Images or PDFs (multiple)</span>
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

      {/* ===== ENHANCED PREVIEW (Multi-file) ===== */}
      {state === "preview" && (
        <div className="preview-screen enhanced">
          <div className="top-nav">
            <button className="nav-btn" onClick={reset}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </button>
            <span className="nav-title">
              Preview {files.length > 1 ? `(${files.length} files)` : ""}
            </span>
            <div style={{ width: 36 }} />
          </div>

          {files.length === 1 ? (
            // Single file preview (original layout)
            <div className="preview-area enhanced-preview-area">
              {previewUrls[0] ? (
                <div className="preview-container">
                  <img src={previewUrls[0]} alt="Preview" className="preview-img enhanced-preview-img" />
                  <div className="preview-badge">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <span>{files[0]?.name || "Document"}</span>
                  </div>
                </div>
              ) : (
                <div className="pdf-placeholder">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                  <span>{files[0]?.name || "PDF Document"}</span>
                </div>
              )}
            </div>
          ) : (
            // Multi-file grid preview
            <div className="multi-preview-area">
              <div className="multi-preview-grid">
                {files.map((f, i) => (
                  <div key={i} className="multi-preview-item">
                    <button className="multi-remove-btn" onClick={() => removeFile(i)} aria-label="Remove file">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                    {previewUrls[i] ? (
                      <img src={previewUrls[i]!} alt={f.name} className="multi-preview-thumb" />
                    ) : (
                      <div className="multi-preview-pdf">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      </div>
                    )}
                    <span className="multi-preview-name">{f.name}</span>
                    <span className="multi-preview-size">{(f.size / 1024).toFixed(0)} KB</span>
                  </div>
                ))}
                {/* Add more button */}
                <label className="multi-preview-item multi-add-more">
                  <input type="file" accept="image/*,.pdf,application/pdf" multiple onChange={handleFileUpload} style={{ display: "none" }} />
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  <span className="multi-preview-name">Add More</span>
                </label>
              </div>
            </div>
          )}

          <div className="preview-info-strip">
            <div className="info-chip">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span>{files.length} file{files.length !== 1 ? "s" : ""} · {(totalSize / 1024).toFixed(0)} KB</span>
            </div>
            <div className="info-chip">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
              <span>Ready to scan</span>
            </div>
          </div>
          <div className="bottom-actions">
            <button className="btn btn-ghost" onClick={reset}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={startScan}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              Scan {files.length > 1 ? `${files.length} Documents` : "Document"}
            </button>
          </div>
        </div>
      )}

      {/* ===== PROCESSING ===== */}
      {state === "processing" && (
        <div className="preview-screen">
          <div className="preview-area">
            {previewUrls[processingIndex] && <img src={previewUrls[processingIndex]!} alt="Scanning" className="preview-img" style={{ opacity: 0.2 }} />}
            <div className="processing-overlay">
              <div className="spinner-ring">
                <svg viewBox="0 0 72 72">
                  <circle className="track" cx="36" cy="36" r="32" />
                  <circle className="fill" cx="36" cy="36" r="32"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference * (1 - progress / 100)}
                  />
                </svg>
                <div className="spinner-pct">{Math.round(progress)}%</div>
              </div>
              <div className="spinner-label">{statusText}</div>
              {files.length > 1 && (
                <div className="batch-progress-info">
                  <span>Document {processingIndex + 1} of {files.length}</span>
                  <div className="batch-dots">
                    {files.map((_, i) => (
                      <div key={i} className={`batch-dot ${i < processingIndex ? "done" : i === processingIndex ? "active" : ""}`} />
                    ))}
                  </div>
                </div>
              )}
              <div className="processing-steps">
                <div className={`step ${progress >= (processingIndex / files.length) * 100 + 1 ? "active" : ""} ${progress >= (processingIndex / files.length) * 100 + 25 ? "done" : ""}`}>
                  <div className="step-dot" />
                  <span>Upload</span>
                </div>
                <div className="step-line" />
                <div className={`step ${progress >= (processingIndex / files.length) * 100 + 25 ? "active" : ""} ${progress >= (processingIndex / files.length) * 100 + 60 ? "done" : ""}`}>
                  <div className="step-dot" />
                  <span>OCR</span>
                </div>
                <div className="step-line" />
                <div className={`step ${progress >= (processingIndex / files.length) * 100 + 60 ? "active" : ""} ${progress >= (processingIndex / files.length) * 100 + 80 ? "done" : ""}`}>
                  <div className="step-dot" />
                  <span>Identify</span>
                </div>
                <div className="step-line" />
                <div className={`step ${progress >= (processingIndex / files.length) * 100 + 80 ? "active" : ""} ${progress >= 100 ? "done" : ""}`}>
                  <div className="step-dot" />
                  <span>Extract</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== RESULTS ===== */}
      {state === "results" && activeResult && (() => {
        const docColor = DOC_TYPE_COLORS[activeResult.documentType] || DOC_TYPE_COLORS.unknown;
        const docIcon = DOC_TYPE_ICONS[activeResult.documentType] || DOC_TYPE_ICONS.unknown;

        return (
          <div className="results-screen">
            <div className="results-image">
              <div className="top-nav overlay-nav">
                <button className="nav-btn" onClick={reset}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                </button>
                <span className="nav-title">
                  {results.length > 1 ? `Results (${activeIndex + 1}/${results.length})` : "Scan Results"}
                </span>
                <div style={{ width: 36 }} />
              </div>
              {activeResult.previewUrl ? (
                <img src={activeResult.previewUrl} alt="Scanned" className="preview-img" />
              ) : (
                <div className="pdf-placeholder dark">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  <span>{activeResult.file?.name}</span>
                </div>
              )}
            </div>

            <div className="results-sheet">
              <div className="sheet-handle" />

              {/* Document tabs for multi-results */}
              {results.length > 1 && (
                <div className="sheet-section">
                  <div className="doc-tabs-scroll">
                    <div className="doc-tabs">
                      {results.map((r, i) => (
                        <button
                          key={i}
                          className={`doc-tab ${i === activeIndex ? "active" : ""}`}
                          onClick={() => setActiveIndex(i)}
                        >
                          <span className="doc-tab-icon">
                            {DOC_TYPE_ICONS[r.documentType] || "📄"}
                          </span>
                          <span className="doc-tab-label">{r.file.name.length > 12 ? r.file.name.slice(0, 12) + "…" : r.file.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Document Type Identification */}
              <div className="sheet-section">
                <div className="doc-type-card" style={{ borderColor: docColor + "40" }}>
                  <div className="doc-type-icon" style={{ background: docColor + "18", color: docColor }}>
                    {docIcon}
                  </div>
                  <div className="doc-type-info">
                    <div className="doc-type-label">{activeResult.documentLabel}</div>
                    <div className="doc-type-meta">
                      {activeResult.typeConfidence > 0 && (
                        <span className="type-conf" style={{ color: docColor }}>
                          {activeResult.typeConfidence}% match
                        </span>
                      )}
                      <span className="method-badge small">{activeResult.parseMethod === "ai" ? "AI" : "Regex"}</span>
                      {activeResult.isForm && <span className="form-badge">Form</span>}
                    </div>
                  </div>
                </div>
              </div>

              {/* Confidence */}
              <div className="sheet-section">
                <div className="confidence-card">
                  <div className="conf-info">
                    <div className="conf-label">OCR Confidence</div>
                    <div className="conf-bar">
                      <div
                        className={`conf-bar-fill ${activeResult.confidence >= 80 ? "high" : activeResult.confidence >= 50 ? "mid" : "low"}`}
                        style={{ width: `${activeResult.confidence}%` }}
                      />
                    </div>
                  </div>
                  <span className="conf-pct">{Math.round(activeResult.confidence)}%</span>
                </div>
              </div>

              {/* Editable Fields */}
              <div className="sheet-section">
                <div className="sheet-title-row">
                  <span className="sheet-title">
                    {activeResult.parsedFields.filter(f => f.value.trim()).length > 0 ? "Extracted Fields" : "No Fields Detected"}
                  </span>
                  <button
                    className={`edit-toggle ${activeResult.editMode ? "active" : ""}`}
                    onClick={() => toggleResultEditMode(activeIndex)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    {activeResult.editMode ? "Done" : "Edit"}
                  </button>
                </div>

                <div className="fields-grid">
                  {activeResult.parsedFields.map((f, i) => (
                    <div key={i} className={`field-item ${activeResult.editMode ? "editing" : ""} ${!f.value.trim() ? "empty" : ""}`}>
                      <span className="field-key">{f.key.replace(/_/g, " ")}</span>
                      {activeResult.editMode ? (
                        <input
                          className="field-input"
                          value={f.value}
                          onChange={e => updateResultField(activeIndex, i, e.target.value)}
                          placeholder="Enter value..."
                        />
                      ) : (
                        <span className="field-val">{f.value || "—"}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Raw Text Toggle */}
              <div className="sheet-section">
                <button className="raw-toggle" onClick={() => toggleResultRawText(activeIndex)}>
                  <span>Raw OCR Text</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: activeResult.showRawText ? "rotate(180deg)" : "none", transition: "transform 200ms" }}>
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </button>
                {activeResult.showRawText && (
                  <>
                    <div className="ai-clean-bar">
                      <div className="ai-clean-label">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2z"/>
                        </svg>
                        <span>AI Clean</span>
                      </div>
                      <button
                        className={`ai-toggle-switch ${activeResult.aiCleaned ? "active" : ""} ${activeResult.aiCleaning ? "loading" : ""}`}
                        onClick={() => handleAiClean(activeIndex)}
                        disabled={activeResult.aiCleaning}
                        aria-label="Toggle AI cleaning"
                      >
                        <div className="ai-toggle-knob">
                          {activeResult.aiCleaning && <div className="ai-toggle-spinner" />}
                        </div>
                      </button>
                    </div>
                    <pre className={`raw-box ${activeResult.aiCleaned ? "ai-cleaned" : ""}`}>
                      {activeResult.rawText || "No text detected"}
                    </pre>
                  </>
                )}
              </div>

              {/* Actions */}
              <div className="action-row">
                {results.length > 1 && (
                  <button
                    className="btn btn-save"
                    onClick={saveAllToStaff}
                    disabled={saving}
                  >
                    {saving ? (
                      <>
                        <div className="btn-spinner" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                          <polyline points="17 21 17 13 7 13 7 21" />
                          <polyline points="7 3 7 8 15 8" />
                        </svg>
                        Save All ({results.length})
                      </>
                    )}
                  </button>
                )}
                <button
                  className={`btn ${results.length > 1 ? "btn-ghost" : "btn-save"}`}
                  onClick={saveToStaff}
                  disabled={saving}
                >
                  {saving ? (
                    <>
                      <div className="btn-spinner" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                        <polyline points="17 21 17 13 7 13 7 21" />
                        <polyline points="7 3 7 8 15 8" />
                      </svg>
                      {results.length > 1 ? "Save This" : "Save to Staff Record"}
                    </>
                  )}
                </button>
              </div>
              <div className="action-row" style={{ paddingTop: 0 }}>
                <button className="btn btn-success" onClick={downloadDB}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Export .db
                </button>
                <button className="btn btn-ghost" onClick={reset}>New Scan</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ===== SAVED CONFIRMATION ===== */}
      {state === "saved" && selectedStaff && (
        <div className="saved-screen">
          <div className="saved-content">
            <div className="saved-check">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <h2 className="saved-title">{results.length > 1 ? "Documents Saved!" : "Document Saved!"}</h2>
            <p className="saved-sub">Saved under <strong>{selectedStaff.name}</strong></p>

            {/* Staff card */}
            <div className="staff-card">
              <div className="staff-avatar">
                {selectedStaff.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div className="staff-info">
                <div className="staff-name">{selectedStaff.name}</div>
                {selectedStaff.department && (
                  <div className="staff-dept">{selectedStaff.department}</div>
                )}
                <div className="staff-docs-count">
                  {selectedStaff.documents?.length || 0} document{(selectedStaff.documents?.length || 0) !== 1 ? "s" : ""} on file
                </div>
              </div>
            </div>

            {/* Documents list */}
            {selectedStaff.documents && selectedStaff.documents.length > 0 && (
              <div className="saved-docs-list">
                <div className="section-label">Documents</div>
                {selectedStaff.documents.map(doc => (
                  <div key={doc.id} className="saved-doc-item">
                    <span className="saved-doc-icon">
                      {DOC_TYPE_ICONS[doc.documentType] || "📄"}
                    </span>
                    <div className="saved-doc-info">
                      <span className="saved-doc-type">{doc.documentLabel || doc.documentType.replace(/_/g, " ")}</span>
                      <span className="saved-doc-date">
                        {new Date(doc.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <span className="saved-doc-status">{doc.status}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="saved-actions">
              <button className="btn btn-primary" onClick={reset}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Scan Another
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
