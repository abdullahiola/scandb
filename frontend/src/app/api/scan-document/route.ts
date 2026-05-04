import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Rebuild FormData to ensure proper forwarding
    const outgoing = new FormData();
    outgoing.append("file", file);

    const res = await fetch(`${BACKEND_URL}/scan-document`, {
      method: "POST",
      body: outgoing,
    });

    if (!res.ok) {
      let err;
      try {
        err = await res.json();
      } catch {
        err = { error: `Backend returned ${res.status}` };
      }
      return NextResponse.json(err, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (e: any) {
    console.error("scan-document proxy error:", e);
    return NextResponse.json(
      { error: `Backend unreachable: ${e.message}` },
      { status: 502 }
    );
  }
}
