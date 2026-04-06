"use client";

import { useState } from "react";
import { deleteCollection } from "@/lib/actions";
import { useRouter } from "next/navigation";

interface Document {
  id: number;
  fileName: string;
  parsedData: string;
  confidence: number;
  status: string;
  createdAt: Date;
}

interface CollectionActionsProps {
  collectionId: number;
  documents: Document[];
}

export function CollectionActions({ collectionId, documents }: CollectionActionsProps) {
  const router = useRouter();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const exportCSV = () => {
    if (documents.length === 0) return;

    // Collect all possible fields
    const allFields = new Set<string>();
    const parsedDocs = documents.map((doc) => {
      try {
        const parsed = JSON.parse(doc.parsedData);
        Object.keys(parsed).forEach((k) => allFields.add(k));
        return parsed;
      } catch {
        return {};
      }
    });

    const fields = Array.from(allFields);
    const header = ["fileName", "confidence", "status", "scannedAt", ...fields];

    const rows = documents.map((doc, i) => {
      const parsed = parsedDocs[i];
      return [
        doc.fileName,
        String(doc.confidence),
        doc.status,
        new Date(doc.createdAt).toISOString(),
        ...fields.map((f) => String(parsed[f] || "")),
      ];
    });

    const csvContent = [
      header.join(","),
      ...rows.map((row) =>
        row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `collection_${collectionId}_export.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportJSON = () => {
    if (documents.length === 0) return;

    const data = documents.map((doc) => {
      let parsed = {};
      try { parsed = JSON.parse(doc.parsedData); } catch { /* ignore */ }
      return {
        fileName: doc.fileName,
        confidence: doc.confidence,
        status: doc.status,
        scannedAt: doc.createdAt,
        data: parsed,
      };
    });

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `collection_${collectionId}_export.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteCollection(collectionId);
      router.push("/collections");
    } catch (error) {
      console.error("Delete error:", error);
    }
    setDeleting(false);
  };

  return (
    <>
      <button className="btn btn-secondary btn-sm" onClick={exportCSV}>
        📥 Export CSV
      </button>
      <button className="btn btn-secondary btn-sm" onClick={exportJSON}>
        📥 JSON
      </button>
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => setShowDeleteConfirm(true)}
        style={{ color: "#ef4444" }}
      >
        🗑️ Delete
      </button>

      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Delete Collection?</h3>
            </div>
            <div className="modal-body">
              <p style={{ color: "var(--text-secondary)" }}>
                This will permanently delete the collection and all {documents.length} document(s) in it.
                This action cannot be undone.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? (
                  <>
                    <span className="spinner" /> Deleting...
                  </>
                ) : (
                  "Delete Collection"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
