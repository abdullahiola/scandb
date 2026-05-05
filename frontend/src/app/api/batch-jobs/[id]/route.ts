import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const res = await fetch(`${BACKEND_URL}/batch-jobs/${id}`);

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
    console.error("batch-jobs proxy error:", e);
    return NextResponse.json(
      { error: `Backend unreachable: ${e.message}` },
      { status: 502 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    const res = await fetch(`${BACKEND_URL}/batch-jobs/${id}/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
    console.error("batch commit proxy error:", e);
    return NextResponse.json(
      { error: `Backend unreachable: ${e.message}` },
      { status: 502 }
    );
  }
}
