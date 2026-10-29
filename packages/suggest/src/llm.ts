import { createHash } from "node:crypto";

/**
 * The one seam to a model. Every call asks for a JSON object matching a schema, at temperature 0 with a fixed
 * seed, so the same question always gets the same answer and can be remembered.
 */
export interface LlmClient {
  readonly model: string;
  json(prompt: string, schema: object): Promise<unknown>;
}

/** The model could not be reached (no key, network, server error). Never cached. */
export class LlmUnavailable extends Error {}
/** The model answered, but not with something usable. Resolvers raise this for any answer outside a closed set. */
export class LlmBadOutput extends Error {}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

/** Reads the same names as `.env.example`. Null when no key is set, which means "suggestions are off". */
export function llmConfigFromEnv(env: Record<string, string | undefined> = process.env): LlmConfig | null {
  const apiKey = env.NEBIUS_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: env.NEBIUS_BASE_URL?.trim() || "https://api.tokenfactory.nebius.com/v1/",
    model: env.NEBIUS_MODEL?.trim() || "nvidia/Nemotron-3-Ultra-550b-a55b",
  };
}

const THINKING = /<think>[\s\S]*?<\/think>/g;

/** Models wrap JSON in fences, sentences or a thinking block; take the outermost object. */
export function parseJsonObject(raw: string): Record<string, unknown> {
  let text = (raw ?? "").replace(THINKING, "").trim();
  if (text.startsWith("```")) text = text.replace(/^```[a-z]*\s*|\s*```$/g, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new LlmBadOutput("response was not the expected JSON");
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
      throw new LlmBadOutput("response was not the expected JSON");
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new LlmBadOutput("response was not a JSON object");
  return parsed as Record<string, unknown>;
}

/** Any OpenAI-compatible chat endpoint (Nebius, OpenAI, vLLM). */
export function openAiCompatible(cfg: LlmConfig, fetchImpl: typeof fetch = fetch): LlmClient {
  let schemaOk = true; // a server that refuses `json_schema` once is not asked again
  const url = cfg.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  return {
    model: cfg.model,
    async json(prompt, schema) {
      const messages = [
        { role: "system", content: "Answer with one JSON object that matches this JSON Schema, and nothing else:\n" + JSON.stringify(schema) },
        { role: "user", content: prompt },
      ];
      const formats = [...(schemaOk ? [{ type: "json_schema", json_schema: { name: "answer", schema } }] : []), { type: "json_object" }];
      for (const [i, response_format] of formats.entries()) {
        let res: Response;
        try {
          res = await fetchImpl(url, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
            body: JSON.stringify({ model: cfg.model, messages, response_format, temperature: 0, seed: 0 }),
            signal: AbortSignal.timeout(cfg.timeoutMs ?? 120_000),
          });
        } catch (e) {
          throw new LlmUnavailable(`${cfg.model} call failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (res.status === 400 && i + 1 < formats.length) {
          schemaOk = false;
          continue;
        }
        if (!res.ok) {
          // The body can echo the request, so never include it: it could carry the key's account details.
          throw new LlmUnavailable(`${cfg.model} answered ${res.status}`);
        }
        const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
        return parseJsonObject(body?.choices?.[0]?.message?.content ?? "");
      }
      throw new LlmBadOutput("no response format was accepted");
    },
  };
}

/** Remembers answers by (model, prompt, schema). Sound only because decoding is deterministic. Failures are never kept. */
export function withCache(inner: LlmClient, store: Map<string, unknown> = new Map()): LlmClient & { readonly size: number } {
  return {
    model: inner.model,
    get size() { return store.size; },
    async json(prompt, schema) {
      const key = createHash("sha256").update(JSON.stringify([inner.model, prompt, schema])).digest("hex");
      if (store.has(key)) return structuredClone(store.get(key));
      const answer = await inner.json(prompt, schema);
      store.set(key, structuredClone(answer));
      return answer;
    },
  };
}

/** Short id of the exact prompt text, stored as provenance so two runs can be compared. */
export const hashPrompt = (prompt: string): string => createHash("sha256").update(prompt).digest("hex").slice(0, 12);
