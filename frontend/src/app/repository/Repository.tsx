"use client";

import { useState, useEffect, useCallback } from "react";
import "./repository.css";

// ── Types ──────────────────────────────────────────────
interface StaffDoc {
  id: number;
  documentType: string;
  documentLabel: string;
  fileName: string;
  rawText: string;
  extractedData: string;
  fullContent: string;
  confidence: number;
  isForm: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface Staff {
  id: number;
  name: string;
  department: string;
  staffId: string;
  createdAt: string;
  updatedAt: string;
  documents: StaffDoc[];
}

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

const DOC_TYPE_LABELS: Record<string, string> = {
  confirmation_of_appointment: "Confirmation",
  assumption_of_duty: "Assumption",
  promotion_exercise: "Promotion",
  posting: "Posting",
};

// ── Component ──────────────────────────────────────────
export default function Repository() {
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [expandedDoc, setExpandedDoc] = useState<number | null>(null);
  const [showRawText, setShowRawText] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Edit mode state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDept, setEditDept] = useState("");

  // Delete modal
  const [deleteModal, setDeleteModal] = useState<{
    type: "staff" | "document";
    staffId: number;
    docId?: number;
    label: string;
  } | null>(null);

  // Add staff modal
  const [addStaffModal, setAddStaffModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDept, setNewDept] = useState("");
  const [newStaffId, setNewStaffId] = useState("");
  const [addingSaving, setAddingSaving] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // ── Data fetch ──────────────────────────────────
  const fetchStaff = useCallback(async () => {
    try {
      const res = await fetch("/api/staff");
      if (res.ok) {
        const data = await res.json();
        setStaffList(data.staff || []);
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStaffDetail = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/staff/${id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedStaff(data.staff);
      }
    } catch {
      showToast("Failed to load staff details");
    }
  }, []);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  // ── Actions ──────────────────────────────────
  const selectStaff = (staff: Staff) => {
    setSelectedStaff(staff);
    setExpandedDoc(null);
    setShowRawText(null);
    setEditing(false);
    fetchStaffDetail(staff.id);
  };

  const startEdit = () => {
    if (!selectedStaff) return;
    setEditName(selectedStaff.name);
    setEditDept(selectedStaff.department);
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!selectedStaff) return;
    try {
      const res = await fetch(`/api/staff/${selectedStaff.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName, department: editDept }),
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedStaff(data.staff);
        await fetchStaff();
        setEditing(false);
        showToast("Staff updated!");
      } else {
        const err = await res.json();
        showToast(err.error || "Update failed");
      }
    } catch {
      showToast("Update failed");
    }
  };

  const updateDocStatus = async (docId: number, status: string) => {
    if (!selectedStaff) return;
    try {
      const res = await fetch(
        `/api/staff/${selectedStaff.id}/documents/${docId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }
      );
      if (res.ok) {
        await fetchStaffDetail(selectedStaff.id);
        showToast(`Status updated to ${status}`);
      }
    } catch {
      showToast("Status update failed");
    }
  };

  const confirmDelete = async () => {
    if (!deleteModal) return;
    try {
      if (deleteModal.type === "staff") {
        const res = await fetch(`/api/staff/${deleteModal.staffId}`, {
          method: "DELETE",
        });
        if (res.ok) {
          setSelectedStaff(null);
          await fetchStaff();
          showToast("Staff deleted");
        }
      } else {
        const res = await fetch(
          `/api/staff/${deleteModal.staffId}/documents/${deleteModal.docId}`,
          { method: "DELETE" }
        );
        if (res.ok) {
          await fetchStaffDetail(deleteModal.staffId);
          await fetchStaff();
          showToast("Document deleted");
        }
      }
    } catch {
      showToast("Delete failed");
    }
    setDeleteModal(null);
  };

  const exportDB = async () => {
    try {
      const res = await fetch("/api/export-staff-db");
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `scandb_staff_${new Date().toISOString().slice(0, 10)}.db`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("Database exported!");
    } catch {
      showToast("Export failed");
    }
  };

  const addStaff = async () => {
    if (!newName.trim()) {
      showToast("Staff name is required");
      return;
    }
    setAddingSaving(true);
    try {
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          department: newDept.trim(),
          staffId: newStaffId.trim(),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        await fetchStaff();
        setSelectedStaff(data.staff);
        setAddStaffModal(false);
        setNewName("");
        setNewDept("");
        setNewStaffId("");
        showToast("Staff record created!");
      } else {
        const err = await res.json();
        showToast(err.error || "Failed to create staff");
      }
    } catch {
      showToast("Failed to create staff");
    } finally {
      setAddingSaving(false);
    }
  };

  // ── Filtering ──────────────────────────────────
  const filtered = staffList.filter((s) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      s.name.toLowerCase().includes(q) ||
      s.department.toLowerCase().includes(q) ||
      s.staffId.toLowerCase().includes(q);

    const matchesType =
      !typeFilter ||
      s.documents?.some((d: StaffDoc) => d.documentType === typeFilter);

    return matchesSearch && matchesType;
  });

  // ── Stats ──────────────────────────────────
  const totalDocs = staffList.reduce(
    (sum, s) => sum + (s.documents?.length || 0),
    0
  );
  const typeCounts: Record<string, number> = {};
  staffList.forEach((s) =>
    s.documents?.forEach((d: StaffDoc) => {
      typeCounts[d.documentType] = (typeCounts[d.documentType] || 0) + 1;
    })
  );

  // ── Parse extracted fields ──────────────────
  const parseFields = (data: string): Record<string, string> => {
    try {
      return JSON.parse(data || "{}");
    } catch {
      return {};
    }
  };

  const getInitials = (name: string) =>
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

  // ── Render ──────────────────────────────────
  return (
    <div className="repo">
      {/* HEADER */}
      <header className="repo-header">
        <div className="repo-brand">
          <div className="repo-logo-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
          </div>
          <div>
            <h1>ScanDB Repository</h1>
            <span>Central Document Store</span>
          </div>
        </div>
        <div className="repo-header-actions">
          <button className="repo-btn" onClick={exportDB}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export Staff.db
          </button>
          <a href="/" className="repo-btn primary" style={{ textDecoration: "none" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Scan
          </a>
        </div>
      </header>

      {/* STATS */}
      <div className="repo-stats">
        <div className="stat-card">
          <div className="stat-icon" style={{ background: "rgba(99,102,241,0.12)", color: "#6366f1" }}>👥</div>
          <div className="stat-info">
            <div className="stat-value">{staffList.length}</div>
            <div className="stat-label">Staff Records</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: "rgba(16,185,129,0.12)", color: "#10b981" }}>📄</div>
          <div className="stat-info">
            <div className="stat-value">{totalDocs}</div>
            <div className="stat-label">Total Documents</div>
          </div>
        </div>
        {Object.entries(typeCounts).slice(0, 4).map(([type, count]) => (
          <div className="stat-card" key={type}>
            <div className="stat-icon" style={{
              background: (DOC_TYPE_COLORS[type] || "#6b7280") + "18",
              color: DOC_TYPE_COLORS[type] || "#6b7280",
            }}>
              {DOC_TYPE_ICONS[type] || "📄"}
            </div>
            <div className="stat-info">
              <div className="stat-value">{count}</div>
              <div className="stat-label">{DOC_TYPE_LABELS[type] || type.replace(/_/g, " ")}</div>
            </div>
          </div>
        ))}
      </div>

      {/* BODY */}
      <div className="repo-body">
        {/* SIDEBAR */}
        <aside className="repo-sidebar">
          <div className="sidebar-search">
            <div className="search-input-wrap">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              <input
                className="search-input"
                placeholder="Search staff, department..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                id="repo-search"
              />
            </div>
            <button
              className="repo-btn primary add-staff-btn"
              onClick={() => setAddStaffModal(true)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add Staff
            </button>
          </div>

          <div className="filter-chips">
            <button
              className={`filter-chip ${!typeFilter ? "active" : ""}`}
              onClick={() => setTypeFilter(null)}
            >
              All
            </button>
            {Object.entries(DOC_TYPE_LABELS).map(([type, label]) => (
              <button
                key={type}
                className={`filter-chip ${typeFilter === type ? "active" : ""}`}
                onClick={() => setTypeFilter(typeFilter === type ? null : type)}
              >
                <span className="chip-icon">{DOC_TYPE_ICONS[type]}</span>
                {label}
              </button>
            ))}
          </div>

          <div className="staff-list">
            {loading ? (
              <div className="staff-list-empty">
                <div className="loading-spinner" />
                <p>Loading staff records...</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="staff-list-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                <h3>{search ? "No matching staff" : "No staff records"}</h3>
                <p>{search ? "Try a different search term" : "Scan documents to create staff records"}</p>
              </div>
            ) : (
              filtered.map((staff) => (
                <div
                  key={staff.id}
                  className={`staff-list-item ${selectedStaff?.id === staff.id ? "active" : ""}`}
                  onClick={() => selectStaff(staff)}
                >
                  <div className="staff-list-avatar">{getInitials(staff.name)}</div>
                  <div className="staff-list-info">
                    <div className="staff-list-name">{staff.name}</div>
                    <div className="staff-list-meta">
                      {staff.department && <span>{staff.department}</span>}
                      {staff.staffId && <span>PF: {staff.staffId}</span>}
                    </div>
                  </div>
                  <div className="staff-list-badge">
                    {staff.documents?.length || 0}
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* MAIN DETAIL PANEL */}
        <main className="repo-main">
          {!selectedStaff ? (
            <div className="repo-empty-main">
              <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              <h2>Select a Staff Record</h2>
              <p>Choose a staff member from the sidebar to view their scanned documents and extracted data.</p>
            </div>
          ) : (
            <>
              {/* Staff detail header */}
              <div className="detail-header">
                <div className="detail-avatar">{getInitials(selectedStaff.name)}</div>
                <div className="detail-info">
                  {editing ? (
                    <>
                      <input
                        className="detail-edit-input name-input"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Staff name"
                      />
                      <input
                        className="detail-edit-input dept-input"
                        value={editDept}
                        onChange={(e) => setEditDept(e.target.value)}
                        placeholder="Department"
                      />
                    </>
                  ) : (
                    <>
                      <div className="detail-name">{selectedStaff.name}</div>
                      {selectedStaff.department && (
                        <div className="detail-dept">{selectedStaff.department}</div>
                      )}
                      {selectedStaff.staffId && (
                        <div className="detail-id">PF: {selectedStaff.staffId}</div>
                      )}
                    </>
                  )}
                </div>
                <div className="detail-actions">
                  {editing ? (
                    <>
                      <button className="repo-btn primary" onClick={saveEdit}>
                        Save
                      </button>
                      <button className="repo-btn" onClick={() => setEditing(false)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="repo-btn" onClick={startEdit}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        Edit
                      </button>
                      <button
                        className="repo-btn danger"
                        onClick={() =>
                          setDeleteModal({
                            type: "staff",
                            staffId: selectedStaff.id,
                            label: selectedStaff.name,
                          })
                        }
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Documents */}
              <div className="docs-section">
                <div className="docs-section-title">
                  Documents ({selectedStaff.documents?.length || 0})
                </div>
                <div className="docs-grid">
                  {(!selectedStaff.documents || selectedStaff.documents.length === 0) ? (
                    <div className="staff-list-empty">
                      <p>No documents on file for this staff member.</p>
                    </div>
                  ) : (
                    selectedStaff.documents.map((doc) => {
                      const isExpanded = expandedDoc === doc.id;
                      const fields = parseFields(doc.extractedData);
                      const docColor = DOC_TYPE_COLORS[doc.documentType] || "#6b7280";
                      const docIcon = DOC_TYPE_ICONS[doc.documentType] || "📄";

                      return (
                        <div key={doc.id}>
                          <div
                            className={`doc-card ${isExpanded ? "expanded" : ""}`}
                            onClick={() =>
                              setExpandedDoc(isExpanded ? null : doc.id)
                            }
                          >
                            <div
                              className="doc-card-icon"
                              style={{
                                background: docColor + "18",
                                color: docColor,
                              }}
                            >
                              {docIcon}
                            </div>
                            <div className="doc-card-body">
                              <div className="doc-card-title">
                                {doc.documentLabel ||
                                  doc.documentType.replace(/_/g, " ")}
                              </div>
                              <div className="doc-card-meta">
                                <span className="doc-card-file">
                                  {doc.fileName}
                                </span>
                                <span className="doc-card-date">
                                  {new Date(doc.createdAt).toLocaleDateString()}
                                </span>
                                {doc.confidence > 0 && (
                                  <span
                                    className="doc-card-conf"
                                    style={{
                                      color:
                                        doc.confidence >= 80
                                          ? "#10b981"
                                          : doc.confidence >= 50
                                          ? "#f59e0b"
                                          : "#ef4444",
                                    }}
                                  >
                                    {Math.round(doc.confidence)}% conf
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="doc-card-right">
                              <span
                                className={`status-badge ${doc.status}`}
                              >
                                {doc.status}
                              </span>
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                style={{
                                  color: "var(--text-muted)",
                                  transform: isExpanded
                                    ? "rotate(180deg)"
                                    : "none",
                                  transition: "transform 200ms",
                                }}
                              >
                                <path d="M6 9l6 6 6-6" />
                              </svg>
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="doc-detail">
                              {/* Extracted fields */}
                              {Object.keys(fields).length > 0 && (
                                <div className="doc-detail-fields">
                                  {Object.entries(fields).map(([key, val]) => (
                                    <div className="doc-field" key={key}>
                                      <div className="doc-field-key">
                                        {key.replace(/_/g, " ")}
                                      </div>
                                      <div
                                        className={`doc-field-val ${
                                          !val ? "empty" : ""
                                        }`}
                                      >
                                        {val || "—"}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Actions */}
                              <div className="doc-detail-actions">
                                <select
                                  className="status-select"
                                  value={doc.status}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) =>
                                    updateDocStatus(doc.id, e.target.value)
                                  }
                                >
                                  <option value="pending">Pending</option>
                                  <option value="reviewed">Reviewed</option>
                                  <option value="archived">Archived</option>
                                </select>

                                <button
                                  className="repo-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowRawText(
                                      showRawText === doc.id ? null : doc.id
                                    );
                                  }}
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                                  {showRawText === doc.id
                                    ? "Hide Raw Text"
                                    : "Show Raw Text"}
                                </button>

                                <button
                                  className="repo-btn danger"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteModal({
                                      type: "document",
                                      staffId: selectedStaff.id,
                                      docId: doc.id,
                                      label: doc.documentLabel || doc.fileName,
                                    });
                                  }}
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                  Delete
                                </button>
                              </div>

                              {showRawText === doc.id && doc.rawText && (
                                <pre className="doc-raw-text">{doc.rawText}</pre>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      {/* Delete confirmation modal */}
      {deleteModal && (
        <div className="modal-overlay" onClick={() => setDeleteModal(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>Delete {deleteModal.type === "staff" ? "Staff Record" : "Document"}?</h3>
            <p>
              Are you sure you want to delete <strong>{deleteModal.label}</strong>?
              {deleteModal.type === "staff" &&
                " All associated documents will also be permanently deleted."}
              {" "}This action cannot be undone.
            </p>
            <div className="modal-actions">
              <button className="repo-btn" onClick={() => setDeleteModal(null)}>
                Cancel
              </button>
              <button className="repo-btn danger" onClick={confirmDelete}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Staff modal */}
      {addStaffModal && (
        <div className="modal-overlay" onClick={() => setAddStaffModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>Add Staff Record</h3>
            <p>Create a new staff record in the repository.</p>
            <div className="modal-form">
              <div className="modal-field">
                <label className="modal-label">Full Name *</label>
                <input
                  className="modal-input"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. John Doe"
                  autoFocus
                />
              </div>
              <div className="modal-field">
                <label className="modal-label">Department</label>
                <input
                  className="modal-input"
                  value={newDept}
                  onChange={(e) => setNewDept(e.target.value)}
                  placeholder="e.g. Computer Science"
                />
              </div>
              <div className="modal-field">
                <label className="modal-label">PF / Staff ID</label>
                <input
                  className="modal-input"
                  value={newStaffId}
                  onChange={(e) => setNewStaffId(e.target.value)}
                  placeholder="e.g. PF/1234"
                />
              </div>
            </div>
            <div className="modal-actions">
              <button className="repo-btn" onClick={() => setAddStaffModal(false)}>
                Cancel
              </button>
              <button
                className="repo-btn primary"
                onClick={addStaff}
                disabled={addingSaving || !newName.trim()}
              >
                {addingSaving ? "Saving..." : "Create Staff"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
