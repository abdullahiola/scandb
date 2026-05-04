import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

// GET /api/export-staff-db — proxy to backend
export async function GET() {
  try {
    const res = await fetch(`${BACKEND_URL}/export-db`);

    if (!res.ok) {
      const err = await res.json();
      return NextResponse.json(err, { status: res.status });
    }

    const blob = await res.arrayBuffer();
    const timestamp = new Date().toISOString().slice(0, 10);

    return new NextResponse(blob, {
      status: 200,
      headers: {
        "Content-Type": "application/x-sqlite3",
        "Content-Disposition": `attachment; filename="scandb_staff_${timestamp}.db"`,
        "Content-Length": blob.byteLength.toString(),
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: `Backend unreachable: ${e.message}` },
      { status: 502 }
    );
  }
}
