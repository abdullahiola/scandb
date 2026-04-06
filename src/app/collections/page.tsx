import Link from "next/link";
import { getCollections } from "@/lib/actions";
import { CreateCollectionButton } from "@/components/CreateCollectionButton";

export default async function CollectionsPage() {
  const collections = await getCollections();

  return (
    <div className="slide-in">
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 className="page-title">Collections</h1>
          <p className="page-subtitle">
            Organize your scanned documents into structured databases
          </p>
        </div>
        <CreateCollectionButton />
      </div>

      {collections.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📁</div>
          <div className="empty-state-title">No collections yet</div>
          <div className="empty-state-text">
            Collections help you organize scanned documents. Create one to get started, or scan a document and it will create one automatically.
          </div>
          <div style={{ display: "flex", gap: "12px" }}>
            <CreateCollectionButton />
            <Link href="/scan" className="btn btn-secondary">
              📷 Scan Document
            </Link>
          </div>
        </div>
      ) : (
        <div className="collections-grid stagger-children">
          {collections.map((col) => (
            <Link
              key={col.id}
              href={`/collections/${col.id}`}
              style={{ textDecoration: "none" }}
            >
              <div className="card card-clickable collection-card">
                <div className="collection-card-icon">{col.icon}</div>
                <div className="collection-card-name">{col.name}</div>
                <div className="collection-card-desc">
                  {col.description || "No description"}
                </div>
                <div className="collection-card-meta">
                  <span>
                    📄 {col._count.documents} document{col._count.documents !== 1 ? "s" : ""}
                  </span>
                  <span>
                    🕐 {new Date(col.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
