import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    // Read the raw body and forward it with the original content-type
    // This preserves the multipart boundary which gets lost if we parse then re-send
    const contentType = req.headers.get("content-type") || "";
    const body = await req.arrayBuffer();

    const res = await fetch(`${BACKEND_URL}/scan-document`, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: body,
    });

    if (!res.ok) {
      const err = await res.json();
      return NextResponse.json(err, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json(
      { error: `Backend unreachable: ${e.message}` },
      { status: 502 }
    );
  }
}
