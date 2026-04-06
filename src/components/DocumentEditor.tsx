"use client";

import { useState } from "react";
import { updateDocument, deleteDocument } from "@/lib/actions";
import { useRouter } from "next/navigation";

interface DocumentEditorProps {
  documentId: number;
  initialData: Record<string, string>;
  initialStatus: string;
}

export function DocumentEditor({ documentId, initialData, initialStatus }: DocumentEditorProps) {
  const router = useRouter();
  const [fields, setFields] = useState<[string, string][]>(Object.entries(initialData));
  const [status, setStatus] = useState(initialStatus);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const updateFieldValue = (index: number, value: string) => {
    setFields((prev) => {
      const next = [...prev];
      next[index] = [next[index][0], value];
      return next;
    });
  };

  const updateFieldKey = (index: number, key: string) => {
    setFields((prev) => {
      const next = [...prev];
      next[index] = [key, next[index][1]];
      return next;
    });
  };

  const addField = () => {
    setFields((prev) => [...prev, ["", ""]]);
  };

  const removeField = (index: number) => {
    setFields((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const parsedData: Record<string, string> = {};
      fields.forEach(([key, value]) => {
        if (key.trim()) parsedData[key.trim()] = value;
      });

      await updateDocument(documentId, {
        parsedData,
        status,
      });

      setToast("Saved!");
      setTimeout(() => setToast(null), 2000);
      router.refresh();
    } catch (error) {
      console.error("Save error:", error);
      setToast("Failed to save");
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!confirm("Delete this document? This cannot be undone.")) return;
    try {
      await deleteDocument(documentId);
      router.back();
    } catch (error) {
      console.error("Delete error:", error);
    }
  };

  return (
    <div>
      {/* Status selector */}
      <div className="form-group">
        <label className="form-label">Status</label>
        <select
          className="form-select"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="pending">⏳ Pending</option>
          <option value="reviewed">✅ Reviewed</option>
          <option value="archived">📦 Archived</option>
        </select>
      </div>

      {/* Fields */}
      <div className="parsed-fields-grid" style={{ marginBottom: "20px" }}>
        {fields.map(([key, value], i) => (
          <div key={i} className="parsed-field-item">
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input
                className="parsed-field-value"
                style={{
                  flex: 1,
                  fontSize: "12px",
                  padding: "6px 10px",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  fontWeight: 600,
                  color: "var(--text-muted)",
                }}
                value={key}
                onChange={(e) => updateFieldKey(i, e.target.value)}
                placeholder="Field name"
              />
              <button
                className="btn btn-ghost btn-sm btn-icon"
                onClick={() => removeField(i)}
                style={{ color: "var(--text-muted)" }}
              >
                ✕
              </button>
            </div>
            <input
              className="parsed-field-value"
              value={value}
              onChange={(e) => updateFieldValue(i, e.target.value)}
              placeholder="Value"
            />
          </div>
        ))}
      </div>

      <button className="btn btn-ghost btn-sm" onClick={addField} style={{ marginBottom: "24px" }}>
        + Add Field
      </button>

      {/* Actions */}
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? (
            <>
              <span className="spinner" /> Saving...
            </>
          ) : (
            <>💾 Save Changes</>
          )}
        </button>
        <button
          className="btn btn-ghost"
          onClick={handleDelete}
          style={{ color: "#ef4444" }}
        >
          🗑️ Delete Document
        </button>
      </div>

      {toast && (
        <div className="toast toast-success" style={{ position: "fixed" }}>
          ✅ {toast}
        </div>
      )}
    </div>
  );
}
