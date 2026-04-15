import { NextRequest, NextResponse } from "next/server";

const ANTHROPIC_API_KEY = process.env.test || "";

export async function POST(req: NextRequest) {
  try {
    const { rawText } = await req.json();

    if (!rawText || typeof rawText !== "string") {
      return NextResponse.json(
        { error: "No text provided" },
        { status: 400 }
      );
    }

    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "AI service not configured" },
        { status: 500 }
      );
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: `You are an OCR text cleaner. Clean up the following raw OCR text by:
1. Fixing obvious OCR errors (e.g., misread characters like 0/O, 1/l/I, rn/m)
2. Fixing broken words and line breaks
3. Correcting spacing issues
4. Preserving the original document structure and meaning
5. Keeping all original information — do NOT add, summarize, or remove content
6. Fix capitalization issues where obvious

Return ONLY the cleaned text, nothing else. No explanations, no preamble.

Raw OCR text:
${rawText}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      console.error("Anthropic API error:", err);
      return NextResponse.json(
        { error: "AI cleaning failed" },
        { status: 502 }
      );
    }

    const data = await res.json();
    const cleanedText =
      data.content?.[0]?.text || rawText;

    return NextResponse.json({ cleanedText });
  } catch (e: any) {
    console.error("AI clean error:", e);
    return NextResponse.json(
      { error: `AI cleaning failed: ${e.message}` },
      { status: 500 }
    );
  }
}
