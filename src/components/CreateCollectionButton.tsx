"use client";

import { useState } from "react";
import { createCollection } from "@/lib/actions";
import { useRouter } from "next/navigation";

export function CreateCollectionButton() {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("📄");
  const [saving, setSaving] = useState(false);

  const icons = ["📄", "🧾", "📋", "📊", "💼", "🏦", "🏥", "🎓", "🏠", "🛒"];

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createCollection({ name, description, icon });
      setShowModal(false);
      setName("");
      setDescription("");
      setIcon("📄");
      router.refresh();
    } catch (error) {
      console.error("Failed to create collection:", error);
    }
    setSaving(false);
  };

  return (
    <>
      <button className="btn btn-primary" onClick={() => setShowModal(true)}>
        + New Collection
      </button>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Create Collection</h3>
              <button
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => setShowModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Icon</label>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {icons.map((i) => (
                    <button
                      key={i}
                      className={`btn ${icon === i ? "btn-primary" : "btn-secondary"}`}
                      style={{ fontSize: "20px", width: "44px", height: "44px", padding: 0 }}
                      onClick={() => setIcon(i)}
                    >
                      {i}
                    </button>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Name</label>
                <input
                  className="form-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Invoices 2024"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label">Description (optional)</label>
                <textarea
                  className="form-textarea"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What kind of documents will this collection hold?"
                  rows={3}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={saving || !name.trim()}
              >
                {saving ? (
                  <>
                    <span className="spinner" /> Creating...
                  </>
                ) : (
                  "Create Collection"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
