import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("files");

    if (!files.length) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    // Rebuild FormData for backend
    const outgoing = new FormData();
    for (const file of files) {
      if (file instanceof Blob) {
        outgoing.append("files", file);
      }
    }

    const res = await fetch(`${BACKEND_URL}/batch-scan`, {
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
    console.error("batch-scan proxy error:", e);
    return NextResponse.json(
      { error: `Backend unreachable: ${e.message}` },
      { status: 502 }
    );
  }
}
