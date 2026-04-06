import Link from "next/link";
import { getDocuments } from "@/lib/actions";

export default async function DocumentsPage() {
  const documents = await getDocuments();

  return (
    <div className="slide-in">
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 className="page-title">All Documents</h1>
          <p className="page-subtitle">
            Browse all scanned documents across collections
          </p>
        </div>
        <Link href="/scan" className="btn btn-primary">
          📷 Scan New
        </Link>
      </div>

      {documents.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📭</div>
          <div className="empty-state-title">No documents yet</div>
          <div className="empty-state-text">
            Start by scanning your first document. Upload an image or PDF to extract text and save it to a collection.
          </div>
          <Link href="/scan" className="btn btn-primary">
            📷 Scan Your First Document
          </Link>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Collection</th>
                  <th>Extracted Data</th>
                  <th>Confidence</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => {
                  let parsedData: Record<string, string> = {};
                  try {
                    parsedData = JSON.parse(doc.parsedData);
                  } catch { /* ignore */ }

                  const fieldEntries = Object.entries(parsedData).slice(0, 2);

                  return (
                    <tr key={doc.id}>
                      <td>
                        <Link href={`/documents/${doc.id}`} style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                          {doc.fileName}
                        </Link>
                      </td>
                      <td>
                        <Link href={`/collections/${doc.collectionId}`}>
                          {doc.collection.icon} {doc.collection.name}
                        </Link>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                          {fieldEntries.map(([key, value]) => (
                            <span
                              key={key}
                              style={{
                                padding: "2px 8px",
                                background: "var(--bg-tertiary)",
                                borderRadius: "var(--radius-sm)",
                                fontSize: "12px",
                                color: "var(--text-secondary)",
                              }}
                            >
                              <strong>{key}:</strong> {String(value).substring(0, 20)}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div className="confidence-meter">
                          <div className="confidence-bar">
                            <div
                              className={`confidence-bar-fill ${
                                doc.confidence >= 80 ? "high" : doc.confidence >= 50 ? "medium" : "low"
                              }`}
                              style={{ width: `${doc.confidence}%` }}
                            />
                          </div>
                          <span className="confidence-value">{Math.round(doc.confidence)}%</span>
                        </div>
                      </td>
                      <td>
                        <span className={`badge badge-${doc.status}`}>
                          <span className="badge-dot" />
                          {doc.status}
                        </span>
                      </td>
                      <td style={{ color: "var(--text-secondary)", fontSize: "13px", whiteSpace: "nowrap" }}>
                        {new Date(doc.createdAt).toLocaleDateString()}
                      </td>
                      <td>
                        <Link href={`/documents/${doc.id}`} className="btn btn-ghost btn-sm">
                          View →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
