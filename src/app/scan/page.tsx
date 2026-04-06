"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createWorker, Worker } from "tesseract.js";
import { createDocument, getCollections, createCollection } from "@/lib/actions";

type Step = "upload" | "processing" | "review" | "save";

interface ParsedField {
  key: string;
  value: string;
}

interface CollectionItem {
  id: number;
  name: string;
  icon: string;
  schema: string;
  _count?: { documents: number };
}

export default function ScanPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step state
  const [currentStep, setCurrentStep] = useState<Step>("upload");

  // Upload state
  const [dragging, setDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // OCR state
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrStatus, setOcrStatus] = useState("Initializing...");
  const [rawText, setRawText] = useState("");
  const [confidence, setConfidence] = useState(0);

  // Parse state
  const [parsedFields, setParsedFields] = useState<ParsedField[]>([]);
  const [parseMethod, setParseMethod] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [documentType, setDocumentType] = useState("invoice");

  // Save state
  const [collections, setCollections] = useState<CollectionItem[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | null>(null);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [showNewCollection, setShowNewCollection] = useState(false);
  const [uploadedFilePath, setUploadedFilePath] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: string } | null>(null);

  useEffect(() => {
    loadCollections();
  }, []);

  async function loadCollections() {
    const cols = await getCollections();
    setCollections(cols as unknown as CollectionItem[]);
    if (cols.length > 0) {
      setSelectedCollectionId(cols[0].id);
    }
  }

  const showToast = (message: string, type: string = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ============ FILE HANDLING ============

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, []);

  const handleFileSelect = (file: File) => {
    const validTypes = [
      "image/jpeg", "image/png", "image/webp", "image/bmp", "image/tiff",
      "application/pdf",
    ];
    if (!validTypes.includes(file.type)) {
      showToast("Unsupported file type. Use images or PDFs.", "error");
      return;
    }
    setSelectedFile(file);
    if (file.type.startsWith("image/")) {
      setPreviewUrl(URL.createObjectURL(file));
    } else {
      setPreviewUrl(null);
    }
  };

  // ============ OCR PROCESSING ============

  const startOCR = async () => {
    if (!selectedFile) return;

    setCurrentStep("processing");
    setOcrProgress(0);
    setOcrStatus("Initializing OCR engine...");

    let worker: Worker | null = null;

    try {
      // Upload file first
      const formData = new FormData();
      formData.append("file", selectedFile);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadData.success) throw new Error("Upload failed");
      setUploadedFilePath(uploadData.filePath);

      // Run Tesseract OCR
      setOcrStatus("Loading OCR engine...");
      setOcrProgress(10);

      worker = await createWorker("eng", undefined, {
        logger: (m: { status: string; progress: number }) => {
          if (m.status === "recognizing text") {
            setOcrProgress(10 + Math.round(m.progress * 80));
            setOcrStatus("Recognizing text...");
          } else if (m.status === "loading language traineddata") {
            setOcrProgress(5);
            setOcrStatus("Loading language data...");
          }
        },
      });

      const { data } = await worker.recognize(selectedFile);
      setRawText(data.text);
      setConfidence(data.confidence);
      setOcrProgress(90);
      setOcrStatus("Parsing extracted text...");

      await worker.terminate();
      worker = null;

      // Parse with AI
      await parseText(data.text);

      setOcrProgress(100);
      setOcrStatus("Complete!");
      setCurrentStep("review");
    } catch (error) {
      console.error("OCR Error:", error);
      showToast("OCR processing failed. Please try again.", "error");
      setCurrentStep("upload");
      if (worker) {
        try { await worker.terminate(); } catch { /* ignore */ }
      }
    }
  };

  // ============ AI PARSING ============

  const parseText = async (text: string) => {
    setIsParsing(true);
    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawText: text,
          documentType,
          fields: [],
        }),
      });
      const data = await res.json();
      if (data.parsed) {
        const fields = Object.entries(data.parsed).map(([key, value]) => ({
          key,
          value: String(value),
        }));
        setParsedFields(fields);
        setParseMethod(data.method || "unknown");
      }
    } catch (error) {
      console.error("Parse error:", error);
      // Set empty fields
      setParsedFields([]);
    }
    setIsParsing(false);
  };

  // ============ SAVE ============

  const handleSave = async () => {
    if (!selectedCollectionId && !newCollectionName) {
      showToast("Please select or create a collection", "error");
      return;
    }

    setIsSaving(true);
    try {
      let collectionId = selectedCollectionId;

      if (showNewCollection && newCollectionName) {
        const newCol = await createCollection({
          name: newCollectionName,
          icon: documentType === "invoice" ? "🧾" : documentType === "receipt" ? "🧾" : documentType === "form" ? "📋" : "📄",
        });
        collectionId = newCol.id;
        await loadCollections();
      }

      if (!collectionId) {
        showToast("No collection selected", "error");
        setIsSaving(false);
        return;
      }

      const parsedData: Record<string, string> = {};
      parsedFields.forEach((f) => {
        parsedData[f.key] = f.value;
      });

      await createDocument({
        collectionId,
        fileName: selectedFile?.name || "Unknown",
        filePath: uploadedFilePath,
        rawText,
        parsedData,
        confidence,
        status: "reviewed",
      });

      showToast("Document saved successfully!");
      setCurrentStep("save");
      setTimeout(() => router.push(`/collections/${collectionId}`), 1500);
    } catch (error) {
      console.error("Save error:", error);
      showToast("Failed to save document", "error");
    }
    setIsSaving(false);
  };

  // ============ FIELD EDITING ============

  const updateField = (index: number, value: string) => {
    setParsedFields((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], value };
      return next;
    });
  };

  const addField = () => {
    setParsedFields((prev) => [...prev, { key: "", value: "" }]);
  };

  const removeField = (index: number) => {
    setParsedFields((prev) => prev.filter((_, i) => i !== index));
  };

  const updateFieldKey = (index: number, key: string) => {
    setParsedFields((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], key };
      return next;
    });
  };

  // ============ RENDER ============

  const steps = [
    { key: "upload", label: "Upload", icon: "📤" },
    { key: "processing", label: "Process", icon: "⚙️" },
    { key: "review", label: "Review", icon: "👁️" },
    { key: "save", label: "Saved", icon: "✅" },
  ];

  const stepOrder = ["upload", "processing", "review", "save"];
  const currentIndex = stepOrder.indexOf(currentStep);

  return (
    <div className="slide-in">
      <div className="page-header">
        <h1 className="page-title">Scan Document</h1>
        <p className="page-subtitle">
          Upload a document to extract and structure its data
        </p>
      </div>

      {/* Step Indicator */}
      <div className="steps">
        {steps.map((step, i) => (
          <div key={step.key} style={{ display: "contents" }}>
            <div className={`step ${i === currentIndex ? "active" : i < currentIndex ? "done" : ""}`}>
              <div className="step-number">
                {i < currentIndex ? "✓" : step.icon}
              </div>
              <span className="step-label">{step.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`step-line ${i < currentIndex ? "done" : ""}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step Content */}
      {currentStep === "upload" && (
        <div className="slide-in">
          {/* Document Type Selection */}
          <div className="card" style={{ marginBottom: "24px" }}>
            <div style={{ marginBottom: "12px", fontWeight: 600, fontSize: "14px" }}>
              Document Type
            </div>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {[
                { value: "invoice", label: "🧾 Invoice", },
                { value: "receipt", label: "🧾 Receipt" },
                { value: "form", label: "📋 Form" },
                { value: "general", label: "📄 General" },
              ].map((type) => (
                <button
                  key={type.value}
                  className={`btn ${documentType === type.value ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setDocumentType(type.value)}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          {/* Upload Zone */}
          <div
            className={`upload-zone ${dragging ? "dragging" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleFileDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
              }}
            />
            <div className="upload-zone-icon">
              {selectedFile ? "✅" : "📤"}
            </div>
            <div className="upload-zone-text">
              {selectedFile
                ? selectedFile.name
                : "Drop your document here or click to browse"}
            </div>
            <div className="upload-zone-hint">
              {selectedFile
                ? `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB`
                : "Supports JPEG, PNG, WebP, TIFF, BMP, and PDF"}
            </div>
            <div className="upload-zone-formats">
              <span className="format-badge">JPG</span>
              <span className="format-badge">PNG</span>
              <span className="format-badge">PDF</span>
              <span className="format-badge">TIFF</span>
            </div>
          </div>

          {/* Preview + Start */}
          {selectedFile && (
            <div style={{ marginTop: "24px", display: "flex", gap: "16px", alignItems: "flex-start" }}>
              {previewUrl && (
                <div className="card" style={{ flex: 1 }}>
                  <img
                    src={previewUrl}
                    alt="Preview"
                    className="doc-preview"
                  />
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <button className="btn btn-primary btn-lg" onClick={startOCR}>
                  ⚡ Start OCR Processing
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setSelectedFile(null);
                    setPreviewUrl(null);
                  }}
                >
                  ✕ Remove File
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {currentStep === "processing" && (
        <div className="slide-in">
          <div className="card">
            <div className="ocr-progress-container">
              {/* Circular Progress */}
              <div className="ocr-progress-ring">
                <svg width="120" height="120" viewBox="0 0 120 120">
                  <defs>
                    <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#6366f1" />
                      <stop offset="100%" stopColor="#a78bfa" />
                    </linearGradient>
                  </defs>
                  <circle className="ring-bg" cx="60" cy="60" r="52" />
                  <circle
                    className="ring-fill"
                    cx="60"
                    cy="60"
                    r="52"
                    strokeDasharray={`${2 * Math.PI * 52}`}
                    strokeDashoffset={`${2 * Math.PI * 52 * (1 - ocrProgress / 100)}`}
                  />
                </svg>
                <div className="ocr-progress-percent">{Math.round(ocrProgress)}%</div>
              </div>

              <div className="ocr-progress-label">{ocrStatus}</div>

              {/* Stage Indicators */}
              <div className="ocr-stages">
                <div className={`ocr-stage ${ocrProgress >= 5 ? (ocrProgress >= 10 ? "done" : "active") : ""}`}>
                  <span className="ocr-stage-dot" />
                  Loading
                </div>
                <div className={`ocr-stage ${ocrProgress >= 10 ? (ocrProgress >= 90 ? "done" : "active") : ""}`}>
                  <span className="ocr-stage-dot" />
                  Recognizing
                </div>
                <div className={`ocr-stage ${ocrProgress >= 90 ? (ocrProgress >= 100 ? "done" : "active") : ""}`}>
                  <span className="ocr-stage-dot" />
                  Parsing
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {currentStep === "review" && (
        <div className="slide-in">
          {/* Confidence Bar */}
          <div className="card" style={{ marginBottom: "24px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
              <span style={{ fontWeight: 600, fontSize: "14px" }}>OCR Confidence</span>
              <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                Parsed via {parseMethod === "ai" ? "🤖 Claude AI" : "📐 Regex patterns"}
              </span>
            </div>
            <div className="confidence-meter">
              <div className="confidence-bar" style={{ height: "8px" }}>
                <div
                  className={`confidence-bar-fill ${
                    confidence >= 80 ? "high" : confidence >= 50 ? "medium" : "low"
                  }`}
                  style={{ width: `${confidence}%` }}
                />
              </div>
              <span className="confidence-value" style={{ fontSize: "16px" }}>
                {Math.round(confidence)}%
              </span>
            </div>
          </div>

          {/* Split Panel: Raw Text | Parsed Fields */}
          <div className="split-panel">
            {/* Raw Text */}
            <div className="panel">
              <div className="panel-header">
                📝 Raw OCR Text
              </div>
              <div className="panel-body">
                <div className="raw-text-preview">
                  {rawText || "No text extracted"}
                </div>
              </div>
            </div>

            {/* Parsed Fields */}
            <div className="panel">
              <div className="panel-header" style={{ justifyContent: "space-between" }}>
                <span>📊 Extracted Fields</span>
                <button className="btn btn-ghost btn-sm" onClick={addField}>
                  + Add Field
                </button>
              </div>
              <div className="panel-body">
                {isParsing ? (
                  <div style={{ textAlign: "center", padding: "40px" }}>
                    <div className="spinner spinner-lg" style={{ margin: "0 auto 16px" }} />
                    <div style={{ color: "var(--text-secondary)" }}>
                      AI is analyzing your document...
                    </div>
                  </div>
                ) : (
                  <div className="parsed-fields-grid">
                    {parsedFields.length === 0 ? (
                      <div style={{ textAlign: "center", padding: "20px", color: "var(--text-muted)" }}>
                        No fields extracted. Click &ldquo;Add Field&rdquo; to create manually.
                      </div>
                    ) : (
                      parsedFields.map((field, i) => (
                        <div key={i} className="parsed-field-item">
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <input
                              className="parsed-field-value"
                              style={{ flex: 1, fontSize: "12px", padding: "6px 10px", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600, color: "var(--text-muted)" }}
                              value={field.key}
                              onChange={(e) => updateFieldKey(i, e.target.value)}
                              placeholder="Field name"
                            />
                            <button
                              className="btn btn-ghost btn-sm btn-icon"
                              onClick={() => removeField(i)}
                              style={{ color: "var(--text-muted)", fontSize: "16px", flexShrink: 0 }}
                            >
                              ✕
                            </button>
                          </div>
                          <input
                            className="parsed-field-value"
                            value={field.value}
                            onChange={(e) => updateField(i, e.target.value)}
                            placeholder="Value"
                          />
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Save Section */}
          <div className="card" style={{ marginTop: "24px" }}>
            <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "16px" }}>
              Save to Collection
            </div>

            {!showNewCollection ? (
              <div style={{ display: "flex", gap: "12px", alignItems: "flex-end" }}>
                <div className="form-group" style={{ flex: 1, margin: 0 }}>
                  <label className="form-label">Collection</label>
                  <select
                    className="form-select"
                    value={selectedCollectionId || ""}
                    onChange={(e) => setSelectedCollectionId(Number(e.target.value))}
                  >
                    {collections.length === 0 && (
                      <option value="">No collections yet</option>
                    )}
                    {collections.map((col) => (
                      <option key={col.id} value={col.id}>
                        {col.icon} {col.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowNewCollection(true)}
                >
                  + New Collection
                </button>
                <button
                  className="btn btn-primary btn-lg"
                  onClick={handleSave}
                  disabled={isSaving || (!selectedCollectionId && collections.length > 0)}
                >
                  {isSaving ? (
                    <>
                      <span className="spinner" /> Saving...
                    </>
                  ) : (
                    <>💾 Save Document</>
                  )}
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: "12px", alignItems: "flex-end" }}>
                <div className="form-group" style={{ flex: 1, margin: 0 }}>
                  <label className="form-label">New Collection Name</label>
                  <input
                    className="form-input"
                    value={newCollectionName}
                    onChange={(e) => setNewCollectionName(e.target.value)}
                    placeholder="e.g., Invoices 2024, Tax Receipts"
                    autoFocus
                  />
                </div>
                <button
                  className="btn btn-ghost"
                  onClick={() => setShowNewCollection(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary btn-lg"
                  onClick={handleSave}
                  disabled={isSaving || !newCollectionName}
                >
                  {isSaving ? (
                    <>
                      <span className="spinner" /> Saving...
                    </>
                  ) : (
                    <>💾 Create & Save</>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {currentStep === "save" && (
        <div className="slide-in">
          <div className="card" style={{ textAlign: "center", padding: "60px" }}>
            <div style={{ fontSize: "64px", marginBottom: "20px" }}>🎉</div>
            <h2 style={{ fontSize: "24px", fontWeight: 700, marginBottom: "8px" }}>
              Document Saved Successfully!
            </h2>
            <p style={{ color: "var(--text-secondary)", marginBottom: "24px" }}>
              Redirecting to collection...
            </p>
            <div className="spinner spinner-lg" style={{ margin: "0 auto" }} />
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.type === "success" ? "✅" : "❌"} {toast.message}
        </div>
      )}
    </div>
  );
}
