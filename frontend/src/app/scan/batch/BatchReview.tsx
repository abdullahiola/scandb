"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getDocIcon, getDocColor, getDocShortLabel } from "@/constants/documentTypes";
import { useTheme } from "@/components/ThemeProvider";
import "./batch.css";

interface BatchItem {
  index: number;
  source_name: string;
  status: string;
  document_type?: string;
  document_label?: string;
  type_confidence?: number;
  fields?: Record<string, string>;
  confidence?: number;
  staff_group?: string;
  error?: string;
}

interface StaffGroup {
  name: string;
  document_count: number;
  documents: BatchItem[];
}

interface BatchData {
  batch_id: string;
  status: string;
  total_items: number;
  completed_items: number;
  current_step: string;
  items: BatchItem[];
  staff_groups: Record<string, StaffGroup>;
  unmatched: BatchItem[];
  error?: string;
}

type Phase = "upload" | "processing" | "review" | "committed";

export default function BatchReviewPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();

  const [phase, setPhase] = useState<Phase>("upload");
  const [batchId, setBatchId] = useState<string | null>(searchParams.get("id"));
  const [batchData, setBatchData] = useState<BatchData | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [commitResult, setCommitResult] = useState<any>(null);
  const [committing, setCommitting] = useState(false);
  const [corrections, setCorrections] = useState<Record<string, { name?: string; department?: string }>>({});
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll for batch status
  const pollBatch = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/batch-jobs/${id}`);
      if (!res.ok) return;
      const data: BatchData = await res.json();
      setBatchData(data);

      if (data.status === "done" || data.status === "error") {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        setPhase(data.status === "done" ? "review" : "processing");
      }
    } catch {
      /* retry next interval */
    }
  }, []);

  // Start polling when we have a batch ID
  useEffect(() => {
    if (batchId && phase === "processing") {
      pollBatch(batchId);
      pollRef.current = setInterval(() => pollBatch(batchId), 1500);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }
  }, [batchId, phase, pollBatch]);

  // Handle file upload
  const handleUpload = async (files: FileList | File[]) => {
    if (!files.length) return;

    setUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    Array.from(files).forEach((f) => formData.append("files", f));

    try {
      // Simulate upload progress
      const progressInterval = setInterval(() => {
        setUploadProgress((p) => Math.min(p + 5, 90));
      }, 200);

      const res = await fetch("/api/batch-scan", {
        method: "POST",
        body: formData,
      });

      clearInterval(progressInterval);
      setUploadProgress(100);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        alert(err.error || "Upload failed");
        setUploading(false);
        return;
      }

      const data = await res.json();
      setBatchId(data.batch_id);
      setPhase("processing");
    } catch (e: any) {
      alert(`Upload error: ${e.message}`);
    } finally {
      setUploading(false);
    }
  };

  // Commit all results
  const handleCommit = async () => {
    if (!batchId) return;
    setCommitting(true);

    try {
      const res = await fetch(`/api/batch-jobs/${batchId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ corrections }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Commit failed" }));
        alert(err.error || "Commit failed");
        return;
      }

      const result = await res.json();
      setCommitResult(result);
      setPhase("committed");
    } catch (e: any) {
      alert(`Commit error: ${e.message}`);
    } finally {
      setCommitting(false);
    }
  };

  // Drag handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files);
  };

  // Stats
  const totalGroups = batchData ? Object.keys(batchData.staff_groups).length : 0;
  const totalDocs = batchData?.completed_items || 0;
  const errorCount = batchData?.items.filter((i) => i.status === "error").length || 0;
  const unmatchedCount = batchData?.unmatched?.length || 0;

  return (
    <div className="batch-page">
      {/* Header */}
      <header className="batch-header">
        <div className="batch-header-left">
          <Link href="/" className="batch-back-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
          </Link>
          <div>
            <h1 className="batch-title">Batch Scan</h1>
            <p className="batch-subtitle">
              {phase === "upload" && "Upload documents for bulk processing"}
              {phase === "processing" && "Processing documents..."}
              {phase === "review" && `${totalDocs} documents · ${totalGroups} staff groups`}
              {phase === "committed" && "Saved to database"}
            </p>
          </div>
        </div>
        <button className="dash-theme-btn" onClick={toggleTheme} aria-label="Toggle theme">
          {theme === "dark" ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          )}
        </button>
      </header>

      {/* ========== UPLOAD PHASE ========== */}
      {phase === "upload" && (
        <div className="batch-upload-section">
          <div
            className={`batch-dropzone ${dragActive ? "active" : ""} ${uploading ? "uploading" : ""}`}
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? (
              <>
                <div className="batch-upload-spinner" />
                <h3>Uploading...</h3>
                <div className="batch-progress-bar">
                  <div className="batch-progress-fill" style={{ width: `${uploadProgress}%` }} />
                </div>
              </>
            ) : (
              <>
                <div className="batch-upload-icon">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                </div>
                <h3>Drop files or PDF here</h3>
                <p>Upload a multi-page PDF from your scanner, or select multiple image files</p>
                <span className="batch-upload-hint">Supports PDF, JPEG, PNG • Max 500MB</span>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.tiff,.bmp"
              multiple
              onChange={(e) => e.target.files && handleUpload(e.target.files)}
              style={{ display: "none" }}
            />
          </div>

          <div className="batch-tips">
            <div className="batch-tip">
              <span className="batch-tip-icon">📄</span>
              <div>
                <strong>Single PDF</strong>
                <span>Upload the PDF from your scanner — each page becomes a separate document</span>
              </div>
            </div>
            <div className="batch-tip">
              <span className="batch-tip-icon">🖼️</span>
              <div>
                <strong>Multiple Images</strong>
                <span>Select all scanned images at once — each file is processed individually</span>
              </div>
            </div>
            <div className="batch-tip">
              <span className="batch-tip-icon">⚡</span>
              <div>
                <strong>Auto-Grouping</strong>
                <span>Documents are automatically grouped by staff name after OCR</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========== PROCESSING PHASE ========== */}
      {phase === "processing" && batchData && (
        <div className="batch-processing">
          <div className="batch-progress-card">
            <div className="batch-progress-visual">
              <svg viewBox="0 0 120 120" className="batch-circle-progress">
                <circle cx="60" cy="60" r="54" fill="none" stroke="var(--border)" strokeWidth="8" />
                <circle
                  cx="60" cy="60" r="54" fill="none"
                  stroke="var(--accent)" strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 54}`}
                  strokeDashoffset={`${2 * Math.PI * 54 * (1 - (batchData.completed_items / Math.max(batchData.total_items, 1)))}`}
                  transform="rotate(-90 60 60)"
                />
              </svg>
              <div className="batch-progress-center">
                <span className="batch-progress-num">{batchData.completed_items}</span>
                <span className="batch-progress-of">of {batchData.total_items}</span>
              </div>
            </div>
            <div className="batch-progress-info">
              <h3>{batchData.current_step}</h3>
              <div className="batch-progress-bar-lg">
                <div
                  className="batch-progress-fill"
                  style={{
                    width: `${(batchData.completed_items / Math.max(batchData.total_items, 1)) * 100}%`,
                  }}
                />
              </div>
              <p className="batch-progress-eta">
                {batchData.total_items > 0
                  ? `~${Math.ceil((batchData.total_items - batchData.completed_items) * 3)} seconds remaining`
                  : "Starting..."}
              </p>
            </div>
          </div>

          {/* Live results as they come in */}
          {batchData.completed_items > 0 && (
            <div className="batch-live-results">
              <h4>Processing results</h4>
              <div className="batch-live-list">
                {batchData.items
                  .filter((i) => i.status === "done")
                  .slice(-8)
                  .map((item) => (
                    <div className="batch-live-item" key={item.index}>
                      <span className="batch-live-icon" style={{ color: getDocColor(item.document_type || "") }}>
                        {getDocIcon(item.document_type || "")}
                      </span>
                      <span className="batch-live-type">{item.document_label || "Processing..."}</span>
                      <span className="batch-live-name">{item.staff_group || "—"}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========== REVIEW PHASE ========== */}
      {phase === "review" && batchData && (
        <div className="batch-review">
          {/* Summary bar */}
          <div className="batch-summary">
            <div className="batch-summary-stat">
              <span className="batch-summary-num">{totalDocs}</span>
              <span className="batch-summary-label">Documents</span>
            </div>
            <div className="batch-summary-stat">
              <span className="batch-summary-num">{totalGroups}</span>
              <span className="batch-summary-label">Staff</span>
            </div>
            {errorCount > 0 && (
              <div className="batch-summary-stat error">
                <span className="batch-summary-num">{errorCount}</span>
                <span className="batch-summary-label">Errors</span>
              </div>
            )}
            {unmatchedCount > 0 && (
              <div className="batch-summary-stat warn">
                <span className="batch-summary-num">{unmatchedCount}</span>
                <span className="batch-summary-label">Unmatched</span>
              </div>
            )}
          </div>

          {/* Staff groups */}
          <div className="batch-groups">
            {Object.entries(batchData.staff_groups).map(([name, group]) => (
              <div className="batch-group-card" key={name}>
                <div className="batch-group-header">
                  <div className="batch-group-avatar">
                    {name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="batch-group-info">
                    <div className="batch-group-name">{name}</div>
                    <div className="batch-group-dept">
                      {group.documents[0]?.fields?.department || "No department"}
                    </div>
                  </div>
                  <div className="batch-group-badge">{group.document_count} docs</div>
                </div>
                <div className="batch-group-docs">
                  {group.documents.map((doc) => (
                    <div className="batch-group-doc" key={doc.index}>
                      <span
                        className="batch-doc-icon"
                        style={{
                          background: getDocColor(doc.document_type || "") + "18",
                          color: getDocColor(doc.document_type || ""),
                        }}
                      >
                        {getDocIcon(doc.document_type || "")}
                      </span>
                      <span className="batch-doc-type">
                        {doc.document_label || getDocShortLabel(doc.document_type || "")}
                      </span>
                      <span className="batch-doc-conf">
                        {doc.confidence ? `${doc.confidence}%` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Unmatched documents */}
            {batchData.unmatched.length > 0 && (
              <div className="batch-group-card unmatched">
                <div className="batch-group-header">
                  <div className="batch-group-avatar warn-avatar">⚠️</div>
                  <div className="batch-group-info">
                    <div className="batch-group-name">Unmatched Documents</div>
                    <div className="batch-group-dept">No staff name extracted</div>
                  </div>
                  <div className="batch-group-badge warn-badge">{batchData.unmatched.length}</div>
                </div>
                <div className="batch-group-docs">
                  {batchData.unmatched.map((doc) => (
                    <div className="batch-group-doc" key={doc.index}>
                      <span className="batch-doc-icon" style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}>
                        {getDocIcon(doc.document_type || "")}
                      </span>
                      <span className="batch-doc-type">
                        {doc.document_label || doc.source_name}
                      </span>
                      <span className="batch-doc-source">{doc.source_name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Commit button */}
          <div className="batch-commit-bar">
            <button
              className="batch-commit-btn"
              onClick={handleCommit}
              disabled={committing || totalGroups === 0}
            >
              {committing ? (
                <>
                  <span className="batch-btn-spinner" />
                  Saving...
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                  Save All to Database ({totalDocs} documents → {totalGroups} staff)
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ========== COMMITTED PHASE ========== */}
      {phase === "committed" && commitResult && (
        <div className="batch-committed">
          <div className="batch-success-icon">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
          </div>
          <h2>Batch Saved Successfully!</h2>
          <div className="batch-result-stats">
            <div className="batch-result-stat">
              <span>{commitResult.saved_documents}</span>
              <label>Documents Saved</label>
            </div>
            <div className="batch-result-stat">
              <span>{commitResult.staff_created}</span>
              <label>New Staff Created</label>
            </div>
            <div className="batch-result-stat">
              <span>{commitResult.staff_updated}</span>
              <label>Staff Updated</label>
            </div>
          </div>
          {commitResult.errors?.length > 0 && (
            <div className="batch-result-errors">
              <h4>⚠️ {commitResult.errors.length} items skipped</h4>
              {commitResult.errors.map((err: any, i: number) => (
                <div key={i} className="batch-result-error">
                  {err.source}: {err.error}
                </div>
              ))}
            </div>
          )}
          <div className="batch-result-actions">
            <Link href="/repository" className="batch-action-btn primary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              View Repository
            </Link>
            <button className="batch-action-btn" onClick={() => { setPhase("upload"); setBatchId(null); setBatchData(null); setCommitResult(null); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
              Scan Another Batch
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
