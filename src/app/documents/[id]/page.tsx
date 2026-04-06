import Link from "next/link";
import { getDocument } from "@/lib/actions";
import { notFound } from "next/navigation";
import { DocumentEditor } from "@/components/DocumentEditor";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function DocumentDetailPage({ params }: PageProps) {
  const { id } = await params;
  const document = await getDocument(Number(id));

  if (!document) {
    notFound();
  }

  let parsedData: Record<string, string> = {};
  try {
    parsedData = JSON.parse(document.parsedData);
  } catch { /* ignore */ }

  return (
    <div className="slide-in">
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
          <Link href={`/collections/${document.collectionId}`} style={{ color: "var(--text-muted)", fontSize: "14px" }}>
            ← {document.collection.icon} {document.collection.name}
          </Link>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 className="page-title">{document.fileName}</h1>
            <p className="page-subtitle">
              Scanned {new Date(document.createdAt).toLocaleDateString()} • 
              Updated {new Date(document.updatedAt).toLocaleDateString()}
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <span className={`badge badge-${document.status}`}>
              <span className="badge-dot" />
              {document.status}
            </span>
          </div>
        </div>
      </div>

      {/* Confidence */}
      <div className="card" style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
          <span style={{ fontWeight: 600, fontSize: "14px" }}>OCR Confidence</span>
          <span className="confidence-value" style={{ fontSize: "16px" }}>
            {Math.round(document.confidence)}%
          </span>
        </div>
        <div className="confidence-bar" style={{ height: "8px" }}>
          <div
            className={`confidence-bar-fill ${
              document.confidence >= 80 ? "high" : document.confidence >= 50 ? "medium" : "low"
            }`}
            style={{ width: `${document.confidence}%` }}
          />
        </div>
      </div>

      {/* Split Panel */}
      <div className="split-panel">
        {/* Left: Document Preview */}
        <div className="panel">
          <div className="panel-header">
            🖼️ Document
          </div>
          <div className="panel-body">
            {document.filePath && (
              <img
                src={document.filePath}
                alt={document.fileName}
                className="doc-preview"
                style={{ width: "100%", maxHeight: "500px" }}
              />
            )}
            <div style={{ marginTop: "16px" }}>
              <div className="panel-header" style={{ padding: "0 0 12px", border: "none" }}>
                📝 Raw OCR Text
              </div>
              <div className="raw-text-preview" style={{ maxHeight: "300px" }}>
                {document.rawText || "No text extracted"}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Parsed Fields */}
        <div className="panel">
          <div className="panel-header">
            📊 Extracted Data
          </div>
          <div className="panel-body">
            <DocumentEditor
              documentId={document.id}
              initialData={parsedData}
              initialStatus={document.status}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
