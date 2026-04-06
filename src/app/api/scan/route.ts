import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const res = await fetch(`${BACKEND_URL}/scan`, {
      method: "POST",
      body: formData,
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
