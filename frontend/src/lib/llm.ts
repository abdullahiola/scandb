/**
 * Single entry point for text generation.
 *
 * Provider selection (first match wins):
 *   1. OLLAMA_URL set            -> local Ollama (runs inside the Docker stack / VPS)
 *   2. GEMINI_API_KEY set        -> Google Gemini (hosted, e.g. on Vercel)
 *   3. neither                   -> isAIConfigured() === false, routes fall back
 *
 * Set LLM_PROVIDER=gemini|ollama to force one when both are configured.
 */

const OLLAMA_URL = (process.env.OLLAMA_URL || "").replace(/\/+$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:3b-instruct";
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 120_000);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

export type Provider = "ollama" | "gemini" | null;

export function getProvider(): Provider {
  const forced = (process.env.LLM_PROVIDER || "").toLowerCase();
  if (forced === "ollama" && OLLAMA_URL) return "ollama";
  if (forced === "gemini" && GEMINI_API_KEY) return "gemini";
  if (OLLAMA_URL) return "ollama";
  if (GEMINI_API_KEY) return "gemini";
  return null;
}

export function isAIConfigured(): boolean {
  return getProvider() !== null;
}

export interface GenerateOptions {
  /** Ask the model for a JSON object. */
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}

export class LLMError extends Error {
  constructor(message: string, public readonly provider: Provider, public readonly detail?: unknown) {
    super(message);
    this.name = "LLMError";
  }
}

/** Generate text for a prompt. Throws LLMError on provider failure. */
export async function generateText(prompt: string, opts: GenerateOptions = {}): Promise<string> {
  const provider = getProvider();
  if (provider === "ollama") return ollamaGenerate(prompt, opts);
  if (provider === "gemini") return geminiGenerate(prompt, opts);
  throw new LLMError("AI service not configured", null);
}

async function ollamaGenerate(prompt: string, opts: GenerateOptions): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        ...(opts.json ? { format: "json" } : {}),
        options: {
          temperature: opts.temperature ?? 0,
          num_predict: opts.maxTokens ?? 2048,
        },
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new LLMError(`Ollama error ${res.status}`, "ollama", detail);
    }
    const data = await res.json();
    return (data.response ?? "").trim();
  } catch (e) {
    if (e instanceof LLMError) throw e;
    throw new LLMError(`Ollama request failed: ${(e as Error).message}`, "ollama", e);
  } finally {
    clearTimeout(timer);
  }
}

async function geminiGenerate(prompt: string, opts: GenerateOptions): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: opts.maxTokens ?? 2048,
          temperature: opts.temperature ?? 0,
          ...(opts.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
    }
  );
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new LLMError(`Gemini error ${res.status}`, "gemini", detail);
  }
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
}

/** Pull the first JSON object out of a model reply, tolerating code fences and chatter. */
export function extractJsonObject<T = Record<string, string>>(text: string): T | null {
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const candidate = stripped.match(/\{[\s\S]*\}/)?.[0] ?? stripped;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
}
