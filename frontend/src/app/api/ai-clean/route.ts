import { NextRequest, NextResponse } from "next/server";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

export async function POST(req: NextRequest) {
  try {
    const { rawText } = await req.json();

    if (!rawText || typeof rawText !== "string") {
      return NextResponse.json(
        { error: "No text provided" },
        { status: 400 }
      );
    }

    if (!GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "AI service not configured" },
        { status: 500 }
      );
    }

    const prompt = `You are an OCR text cleaner. Clean up the following raw OCR text by:
1. Fixing obvious OCR errors (e.g., misread characters like 0/O, 1/l/I, rn/m)
2. Fixing broken words and line breaks
3. Correcting spacing issues
4. Preserving the original document structure and meaning
5. Keeping all original information — do NOT add, summarize, or remove content
6. Fix capitalization issues where obvious

Return ONLY the cleaned text, nothing else. No explanations, no preamble.

Raw OCR text:
${rawText}`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 4096, temperature: 0 },
        }),
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("Gemini API error:", err);
      return NextResponse.json(
        { error: "AI cleaning failed" },
        { status: 502 }
      );
    }

    const data = await res.json();
    const cleanedText =
      data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

    if (!cleanedText) {
      return NextResponse.json(
        { error: "AI returned empty response" },
        { status: 502 }
      );
    }

    return NextResponse.json({ cleanedText });
  } catch (e: any) {
    console.error("AI clean error:", e);
    return NextResponse.json(
      { error: `AI cleaning failed: ${e.message}` },
      { status: 500 }
    );
  }
}
