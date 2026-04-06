import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `You are a document data extraction assistant. Given raw OCR text from a scanned document, extract structured data based on the provided field schema.

Rules:
1. Extract values that match each field name as closely as possible.
2. For currency fields, return just the numeric value (e.g., "29.99" not "$29.99").
3. For date fields, return in ISO format (YYYY-MM-DD) when possible.
4. If a field cannot be found in the text, return an empty string "".
5. Return ONLY a JSON object with the field names as keys and extracted values as string values.
6. Do not include any explanation or markdown formatting — just the raw JSON object.`;

export async function POST(request: NextRequest) {
  try {
    const { rawText, fields, documentType } = await request.json();

    if (!rawText) {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey === "your-claude-api-key-here") {
      // Fallback: regex-based parsing
      const parsed = regexParse(rawText, fields || []);
      return NextResponse.json({ parsed, method: "regex" });
    }

    const client = new Anthropic({ apiKey });

    let fieldDescription = "";
    if (fields && fields.length > 0) {
      fieldDescription = `\n\nExtract these specific fields:\n${fields
        .map((f: { name: string; type: string }) => `- ${f.name} (type: ${f.type})`)
        .join("\n")}`;
    } else {
      fieldDescription = `\n\nThe document appears to be a ${documentType || "general document"}. Extract all relevant fields you can identify. Common fields for this type include:
- For invoices/receipts: vendor, date, invoice_number, subtotal, tax, total, items, payment_method
- For forms: all labeled fields and their values
- For general documents: title, date, author, key_content, summary`;
    }

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: `${SYSTEM_PROMPT}${fieldDescription}\n\nHere is the OCR text:\n\n---\n${rawText}\n---\n\nExtract the data and return as a JSON object:`,
        },
      ],
    });

    const responseText = message.content[0].type === "text" ? message.content[0].text : "";
    
    // Try to parse the JSON from the response
    let parsed: Record<string, string> = {};
    try {
      // Handle case where response might be wrapped in markdown code blocks
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      }
    } catch {
      console.error("Failed to parse AI response as JSON:", responseText);
      parsed = regexParse(rawText, fields || []);
    }

    return NextResponse.json({ parsed, method: "ai" });
  } catch (error) {
    console.error("Parse error:", error);
    // Fallback to regex
    try {
      const { rawText, fields } = await request.clone().json();
      const parsed = regexParse(rawText, fields || []);
      return NextResponse.json({ parsed, method: "regex-fallback" });
    } catch {
      return NextResponse.json(
        { error: "Failed to parse document" },
        { status: 500 }
      );
    }
  }
}

interface Field {
  name: string;
  type: string;
}

function regexParse(text: string, fields: Field[]): Record<string, string> {
  const result: Record<string, string> = {};

  // Common patterns
  const patterns: Record<string, RegExp[]> = {
    date: [
      /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/,
      /(\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})/,
      /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s+\d{4})/i,
    ],
    email: [/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/],
    phone: [
      /(\+?1?\s*\(?\d{3}\)?[\s\-\.]*\d{3}[\s\-\.]*\d{4})/,
      /(\d{3}[\s\-\.]\d{4})/,
    ],
    currency: [
      /\$\s?([\d,]+\.?\d{0,2})/,
      /(?:total|amount|price|cost|subtotal|tax)[\s:]*\$?\s?([\d,]+\.?\d{0,2})/i,
    ],
    number: [/(\d+(?:\.\d+)?)/],
    url: [/(https?:\/\/[^\s]+)/],
  };

  if (fields.length > 0) {
    for (const field of fields) {
      // Try to find a label match first
      const labelPattern = new RegExp(
        `${field.name.replace(/[_\s]+/g, "[\\s_]*")}[\\s:]*(.+?)(?:\\n|$)`,
        "i"
      );
      const labelMatch = text.match(labelPattern);

      if (labelMatch) {
        result[field.name] = labelMatch[1].trim();
      } else if (patterns[field.type]) {
        // Try type-specific patterns
        for (const pattern of patterns[field.type]) {
          const match = text.match(pattern);
          if (match) {
            result[field.name] = (match[1] || match[0]).trim();
            break;
          }
        }
      }

      if (!result[field.name]) {
        result[field.name] = "";
      }
    }
  } else {
    // Auto-detect common fields
    for (const [type, patternList] of Object.entries(patterns)) {
      for (const pattern of patternList) {
        const match = text.match(pattern);
        if (match) {
          const key = type === "currency" ? "amount" : type;
          if (!result[key]) {
            result[key] = (match[1] || match[0]).trim();
          }
        }
      }
    }

    // Try to extract labeled fields
    const labeledFields = text.matchAll(
      /^([A-Za-z][A-Za-z\s_]{1,30})\s*[:]\s*(.+)$/gm
    );
    for (const match of labeledFields) {
      const key = match[1].trim().toLowerCase().replace(/\s+/g, "_");
      result[key] = match[2].trim();
    }
  }

  return result;
}
