import Link from "next/link";
import { getCollection } from "@/lib/actions";
import { notFound } from "next/navigation";
import { CollectionActions } from "@/components/CollectionActions";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CollectionDetailPage({ params }: PageProps) {
  const { id } = await params;
  const collection = await getCollection(Number(id));

  if (!collection) {
    notFound();
  }

  return (
    <div className="slide-in">
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
            <Link href="/collections" style={{ color: "var(--text-muted)", fontSize: "14px" }}>
              ← Collections
            </Link>
          </div>
          <h1 className="page-title">
            {collection.icon} {collection.name}
          </h1>
          <p className="page-subtitle">
            {collection.description || `${collection.documents.length} documents`}
          </p>
        </div>
        <div style={{ display: "flex", gap: "12px" }}>
          <CollectionActions collectionId={collection.id} documents={collection.documents} />
          <Link href="/scan" className="btn btn-primary">
            + Scan New
          </Link>
        </div>
      </div>

      {collection.documents.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📭</div>
          <div className="empty-state-title">No documents in this collection</div>
          <div className="empty-state-text">
            Scan a document and save it to this collection to start building your database.
          </div>
          <Link href="/scan" className="btn btn-primary">
            📷 Scan Document
          </Link>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Extracted Data</th>
                  <th>Confidence</th>
                  <th>Status</th>
                  <th>Scanned</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {collection.documents.map((doc) => {
                  let parsedData: Record<string, string> = {};
                  try {
                    parsedData = JSON.parse(doc.parsedData);
                  } catch { /* ignore */ }

                  const fieldEntries = Object.entries(parsedData).slice(0, 3);

                  return (
                    <tr key={doc.id}>
                      <td>
                        <Link
                          href={`/documents/${doc.id}`}
                          style={{ fontWeight: 600, color: "var(--text-primary)" }}
                        >
                          {doc.fileName}
                        </Link>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
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
                              <strong>{key}:</strong> {String(value).substring(0, 30)}
                              {String(value).length > 30 ? "…" : ""}
                            </span>
                          ))}
                          {Object.keys(parsedData).length > 3 && (
                            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                              +{Object.keys(parsedData).length - 3} more
                            </span>
                          )}
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
