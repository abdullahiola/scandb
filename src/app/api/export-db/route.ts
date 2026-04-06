import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const params = new URLSearchParams({
      file_name: body.file_name || "scan",
      raw_text: body.raw_text || "",
      confidence: String(body.confidence || 0),
      fields: JSON.stringify(body.fields || {}),
    });

    const res = await fetch(`${BACKEND_URL}/export?${params}`, {
      method: "POST",
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Export failed" }, { status: 500 });
    }

    const blob = await res.arrayBuffer();
    return new NextResponse(blob, {
      headers: {
        "Content-Type": "application/x-sqlite3",
        "Content-Disposition": `attachment; filename="scan_${Date.now()}.db"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: `Backend unreachable: ${e.message}` },
      { status: 502 }
    );
  }
}
