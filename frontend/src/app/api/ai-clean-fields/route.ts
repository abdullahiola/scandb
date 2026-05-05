import { NextRequest, NextResponse } from "next/server";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

export async function POST(req: NextRequest) {
  try {
    const { fields, documentType, rawText } = await req.json();

    if (!fields || typeof fields !== "object") {
      return NextResponse.json(
        { error: "No fields provided" },
        { status: 400 }
      );
    }

    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "AI service not configured" },
        { status: 500 }
      );
    }

    // Build a field list for the prompt
    const fieldEntries = Object.entries(fields)
      .map(([key, value]) => `- ${key}: "${value}"`)
      .join("\n");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        messages: [
          {
            role: "user",
            content: `You are a document data extraction AI. I have a ${documentType || "scanned"} document. The following fields were extracted via OCR and regex, but may contain errors, partial values, or garbage characters.

Your job:
1. Fix OCR errors in field values (e.g., misread characters like 0/O, 1/l/I, rn/m)
2. Fix broken or garbled text
3. Clean up formatting (proper capitalization for names, departments, etc.)
4. If a field value is clearly garbage/nonsensical, set it to an empty string ""
5. If a field value looks reasonable, keep it — do NOT invent data
6. For name fields: format as proper case (e.g., "John Smith")
7. For date fields: format consistently (e.g., "15th March 2024")
8. For department fields: clean up and capitalize properly

Here is the raw OCR text for context:
"""
${(rawText || "").slice(0, 2000)}
"""

Here are the extracted fields to clean:
${fieldEntries}

Return ONLY a valid JSON object with the same keys and cleaned values. No explanations, no markdown code blocks, just the JSON object.`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      console.error("Anthropic API error:", err);
      return NextResponse.json(
        { error: "AI field cleaning failed" },
        { status: 502 }
      );
    }

    const data = await res.json();
    const responseText = data.content?.[0]?.text || "{}";

    // Parse the JSON response
    let cleanedFields: Record<string, string>;
    try {
      // Strip any markdown code block wrapper if present
      const jsonStr = responseText
        .replace(/^```json?\s*/i, "")
        .replace(/```\s*$/, "")
        .trim();
      cleanedFields = JSON.parse(jsonStr);
    } catch {
      console.error("Failed to parse AI response:", responseText);
      return NextResponse.json(
        { error: "AI returned invalid response" },
        { status: 502 }
      );
    }

    return NextResponse.json({ fields: cleanedFields });
  } catch (e: any) {
    console.error("AI field clean error:", e);
    return NextResponse.json(
      { error: `AI field cleaning failed: ${e.message}` },
      { status: 500 }
    );
  }
}
