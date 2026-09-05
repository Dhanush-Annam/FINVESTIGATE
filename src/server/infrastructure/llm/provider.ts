import { GoogleGenAI } from "@google/genai";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

function loadEnvFile(): void {
  try {
    const envPath = resolve(process.cwd(), ".env");
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
      }
    }
  } catch {
    // Ignore error loading .env
  }
}

export function getGeminiModel(): string {
  loadEnvFile();
  return process.env.LLM_MODEL || "gemini-3.5-flash-lite";
}

export function getGeminiApiKey(): string | null {
  loadEnvFile();
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
  return key && key.trim() !== "" ? key : null;
}

export interface LLMCallStats {
  promptTokens?: number;
  candidatesTokens?: number;
  totalTokens?: number;
  latencyMs: number;
}

export interface LLMCallResult<T> {
  data: T | null;
  stats: LLMCallStats;
  error?: string;
}

export async function callGeminiStructuredJSON<T>(
  systemInstruction: string,
  userPrompt: string,
  timeoutMs: number = 15000,
  overrideModel?: string
): Promise<T | null> {
  const res = await callGeminiStructuredJSONWithStats<T>(systemInstruction, userPrompt, timeoutMs, overrideModel);
  return res.data;
}

export async function callGeminiStructuredJSONWithStats<T>(
  systemInstruction: string,
  userPrompt: string,
  timeoutMs: number = 15000,
  overrideModel?: string
): Promise<LLMCallResult<T>> {
  const apiKey = getGeminiApiKey();
  const modelToUse = overrideModel || getGeminiModel();
  const startTime = Date.now();

  if (!apiKey) {
    console.warn("[LLM Provider] No GEMINI_API_KEY or GOOGLE_GENAI_API_KEY found in environment. Using fallback mode.");
    return { data: null, stats: { latencyMs: Date.now() - startTime }, error: "No API key configured" };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    
    // Set up a promise timeout to ensure bounded latency
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`LLM API call timed out after ${timeoutMs}ms`)), timeoutMs)
    );

    const callPromise = (async () => {
      const response = await ai.models.generateContent({
        model: modelToUse,
        contents: [
          { role: "user", parts: [{ text: `${systemInstruction}\n\nUSER INPUT:\n${userPrompt}` }] }
        ],
        config: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      });

      const latencyMs = Date.now() - startTime;
      const usageMetadata = response.usageMetadata;
      const stats: LLMCallStats = {
        promptTokens: usageMetadata?.promptTokenCount,
        candidatesTokens: usageMetadata?.candidatesTokenCount,
        totalTokens: usageMetadata?.totalTokenCount,
        latencyMs,
      };

      const responseText = response.text;
      if (!responseText) {
        throw new Error("Empty response from LLM API");
      }

      // Sanitize potential markdown code block wrappers
      const cleanJsonStr = responseText
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/, "");

      const parsed = JSON.parse(cleanJsonStr) as T;
      return { data: parsed, stats };
    })();

    const result = await Promise.race([callPromise, timeoutPromise]);
    return result;
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errMsg = error instanceof Error ? error.message : String(error);
    console.warn(`[LLM Provider Failure] Model ${modelToUse} failed: ${errMsg}. Degraded gracefully.`);
    return { data: null, stats: { latencyMs }, error: errMsg };
  }
}
