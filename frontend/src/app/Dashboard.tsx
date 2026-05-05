"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  DOC_TYPES,
  getDocIcon,
  getDocColor,
  getDocShortLabel,
  ALL_DOC_TYPE_KEYS,
} from "@/constants/documentTypes";
import { useTheme } from "@/components/ThemeProvider";
import "./dashboard.css";

interface StaffRecord {
  id: number;
  name: string;
  department: string;
  staffId: string;
  createdAt: string;
  updatedAt: string;
  documents: {
    id: number;
    documentType: string;
    documentLabel: string;
    fileName: string;
    status: string;
    createdAt: string;
  }[];
}

export default function Dashboard() {
  const [staffList, setStaffList] = useState<StaffRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
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
  };

  // Compute stats
  const totalStaff = staffList.length;
  const totalDocs = staffList.reduce(
    (sum, s) => sum + (s.documents?.length || 0),
    0
  );

  // Type counts
  const typeCounts: Record<string, number> = {};
  staffList.forEach((s) =>
    s.documents?.forEach((d) => {
      typeCounts[d.documentType] = (typeCounts[d.documentType] || 0) + 1;
    })
  );
  const uniqueTypes = Object.keys(typeCounts).length;

  // Recent staff (last 5 by updatedAt)
  const recentStaff = [...staffList]
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
    .slice(0, 5);

  // Recent documents (flatten, sort, take 6)
  const allDocs = staffList.flatMap((s) =>
    (s.documents || []).map((d) => ({
      ...d,
      staffName: s.name,
      staffDept: s.department,
    }))
  );
  const recentDocs = [...allDocs]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    .slice(0, 6);

  return (
    <div className="dashboard">
      {/* Header */}
      <header className="dash-header">
        <div className="dash-header-left">
          <img src="/ui-logo.jpeg" alt="University Logo" className="dash-uni-logo" />
          <div>
            <h1 className="dash-title">ScanDB</h1>
            <p className="dash-subtitle">Document Management</p>
          </div>
        </div>
        <div className="dash-header-right">
          <button className="dash-theme-btn" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
            {theme === "dark" ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            )}
          </button>
        </div>
      </header>

      {/* Stats */}
      <section className="dash-stats">
        <div className="dash-stat-card primary">
          <div className="dash-stat-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <div className="dash-stat-value">{loading ? "—" : totalStaff}</div>
          <div className="dash-stat-label">Staff Records</div>
        </div>
        <div className="dash-stat-card success">
          <div className="dash-stat-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <div className="dash-stat-value">{loading ? "—" : totalDocs}</div>
          <div className="dash-stat-label">Documents</div>
        </div>
        <div className="dash-stat-card info">
          <div className="dash-stat-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
          </div>
          <div className="dash-stat-value">{loading ? "—" : uniqueTypes}</div>
          <div className="dash-stat-label">Doc Types</div>
        </div>
      </section>

      {/* Quick Actions */}
      <section className="dash-section">
        <h2 className="dash-section-title">Quick Actions</h2>
        <div className="dash-actions-grid">
          <Link href="/scan" className="dash-action-card scan-action">
            <div className="dash-action-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </div>
            <div className="dash-action-info">
              <strong>New Scan</strong>
              <span>Scan a single document</span>
            </div>
            <svg className="dash-action-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </Link>
          <Link href="/scan/batch" className="dash-action-card batch-action">
            <div className="dash-action-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                <line x1="6" y1="6" x2="6.01" y2="6" />
                <line x1="6" y1="18" x2="6.01" y2="18" />
              </svg>
            </div>
            <div className="dash-action-info">
              <strong>Batch Scan</strong>
              <span>Upload 100+ docs from printer</span>
            </div>
            <svg className="dash-action-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </Link>
          <Link href="/repository" className="dash-action-card repo-action">
            <div className="dash-action-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div className="dash-action-info">
              <strong>Repository</strong>
              <span>Browse staff records</span>
            </div>
            <svg className="dash-action-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </Link>
        </div>
      </section>

      {/* Document Types Distribution */}
      {!loading && totalDocs > 0 && (
        <section className="dash-section">
          <h2 className="dash-section-title">Document Types</h2>
          <div className="dash-types-grid">
            {Object.entries(typeCounts)
              .sort(([, a], [, b]) => b - a)
              .map(([type, count]) => (
                <div className="dash-type-chip" key={type}>
                  <span
                    className="dash-type-dot"
                    style={{ background: getDocColor(type) }}
                  />
                  <span className="dash-type-icon">{getDocIcon(type)}</span>
                  <span className="dash-type-name">
                    {getDocShortLabel(type)}
                  </span>
                  <span className="dash-type-count">{count}</span>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* Recent Activity */}
      {!loading && recentDocs.length > 0 && (
        <section className="dash-section">
          <div className="dash-section-header">
            <h2 className="dash-section-title">Recent Activity</h2>
            <Link href="/repository" className="dash-see-all">
              See all →
            </Link>
          </div>
          <div className="dash-activity-list">
            {recentDocs.map((doc) => (
              <div className="dash-activity-item" key={doc.id}>
                <div
                  className="dash-activity-icon"
                  style={{
                    background: getDocColor(doc.documentType) + "18",
                    color: getDocColor(doc.documentType),
                  }}
                >
                  {getDocIcon(doc.documentType)}
                </div>
                <div className="dash-activity-info">
                  <div className="dash-activity-type">
                    {doc.documentLabel || getDocShortLabel(doc.documentType)}
                  </div>
                  <div className="dash-activity-meta">
                    {doc.staffName} · {new Date(doc.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <span
                  className="dash-activity-status"
                  style={{
                    background:
                      doc.status === "verified"
                        ? "rgba(16,185,129,0.12)"
                        : "rgba(245,158,11,0.12)",
                    color:
                      doc.status === "verified" ? "#10b981" : "#f59e0b",
                  }}
                >
                  {doc.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent Staff */}
      {!loading && recentStaff.length > 0 && (
        <section className="dash-section">
          <div className="dash-section-header">
            <h2 className="dash-section-title">Staff Records</h2>
            <Link href="/repository" className="dash-see-all">
              View all →
            </Link>
          </div>
          <div className="dash-staff-list">
            {recentStaff.map((staff) => (
              <Link
                href="/repository"
                className="dash-staff-card"
                key={staff.id}
              >
                <div className="dash-staff-avatar">
                  {staff.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
                <div className="dash-staff-info">
                  <div className="dash-staff-name">{staff.name}</div>
                  <div className="dash-staff-dept">
                    {staff.department || "No department"}
                  </div>
                </div>
                <div className="dash-staff-badge">
                  {staff.documents?.length || 0} docs
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {!loading && totalStaff === 0 && (
        <section className="dash-empty">
          <div className="dash-empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
          </div>
          <h3>No records yet</h3>
          <p>Start by scanning your first document</p>
          <Link href="/scan" className="dash-empty-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            Start Scanning
          </Link>
        </section>
      )}

      {/* Loading state */}
      {loading && (
        <div className="dash-loading">
          <div className="dash-loading-spinner" />
          <span>Loading dashboard...</span>
        </div>
      )}
    </div>
  );
}
