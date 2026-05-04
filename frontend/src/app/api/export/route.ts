import { NextRequest, NextResponse } from "next/server";
import initSqlJs from "sql.js";

export async function POST(request: NextRequest) {
  try {
    const { fileName, rawText, confidence, fields } = await request.json();

    // Initialize sql.js (pure JS, no native modules)
    const SQL = await initSqlJs();
    const db = new SQL.Database();

    // Create tables
    db.run(`
      CREATE TABLE documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_name TEXT NOT NULL,
        raw_text TEXT,
        confidence REAL,
        scanned_at TEXT DEFAULT (datetime('now'))
      )
    `);

    db.run(`
      CREATE TABLE extracted_fields (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL,
        field_name TEXT NOT NULL,
        field_value TEXT,
        FOREIGN KEY (document_id) REFERENCES documents(id)
      )
    `);

    // Insert document
    db.run(
      "INSERT INTO documents (file_name, raw_text, confidence) VALUES (?, ?, ?)",
      [fileName || "unknown", rawText || "", confidence || 0]
    );

    // Insert fields
    if (fields && Array.isArray(fields)) {
      for (const field of fields) {
        if (field.key && field.key.trim()) {
          db.run(
            "INSERT INTO extracted_fields (document_id, field_name, field_value) VALUES (1, ?, ?)",
            [field.key, field.value || ""]
          );
        }
      }
    }

    // Create flat data table
    if (fields && fields.length > 0) {
      const validFields = fields.filter((f: { key: string }) => f.key && f.key.trim());
      if (validFields.length > 0) {
        const cols = validFields.map((f: { key: string }) => {
          const safe = f.key.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
          return `${safe} TEXT`;
        });

        db.run(`
          CREATE TABLE data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_name TEXT,
            ${cols.join(", ")},
            scanned_at TEXT DEFAULT (datetime('now'))
          )
        `);

        const colNames = validFields.map((f: { key: string }) =>
          f.key.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase()
        );
        const placeholders = colNames.map(() => "?").join(", ");
        const values = validFields.map((f: { value: string }) => f.value || "");

        db.run(
          `INSERT INTO data (file_name, ${colNames.join(", ")}) VALUES (?, ${placeholders})`,
          [fileName || "unknown", ...values]
        );
      }
    }

    // Export as binary
    const data = db.export();
    db.close();

    return new NextResponse(Buffer.from(data), {
      headers: {
        "Content-Type": "application/x-sqlite3",
        "Content-Disposition": `attachment; filename="scan_${Date.now()}.db"`,
      },
    });
  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json({ error: "Failed to create database" }, { status: 500 });
  }
}
