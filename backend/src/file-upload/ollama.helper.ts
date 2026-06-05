import axios, { AxiosError } from 'axios';
import { Logger } from '@nestjs/common';
import { LLM_MAX_ATTEMPTS } from './resume-job.types';

const logger = new Logger('OllamaHelper');

// ── Prompt builders ──────────────────────────────────────────────────────────

/**
 * Attempt 1 — strict JSON-only prompt for Ollama native /api/generate.
 * The system field enforces JSON-only mode at the model level.
 */
function buildInitialPrompt(rawText: string): string {
  return `You are a resume data extractor. Read the resume below and output ONLY a valid JSON object.

ABSOLUTE RULES:
- Your entire response must be ONE valid JSON object starting with { and ending with }
- NO markdown, NO code fences, NO backticks, NO explanation text whatsoever
- NO trailing commas, all strings must be quoted, arrays use []
- Use null for missing fields, never omit a key

Output this exact structure filled with data from the resume:
{
  "name": "full name",
  "email": "email address",
  "phone": "phone number",
  "location": "city, country",
  "summary": "brief professional summary",
  "skills": ["skill1", "skill2"],
  "experience": [{"company": "name", "title": "role", "startDate": "date", "endDate": "date", "description": "what they did"}],
  "education": [{"institution": "school name", "degree": "degree type", "field": "field of study", "startDate": "date", "endDate": "date"}],
  "certifications": ["cert1"],
  "languages": ["lang1"],
  "projects": [{"name": "project name", "description": "what it does", "technologies": ["tech1"]}]
}

Resume text to parse:
---
${rawText.slice(0, 6000)}
---

JSON output:`;
}

/**
 * Attempt 2 — simpler schema to reduce token complexity after first failure.
 */
function buildRetryPrompt(rawText: string, previousError: string): string {
  return `PREVIOUS ATTEMPT FAILED: ${previousError}

Output ONLY a raw JSON object. Start with { end with }. No other text.

Extract from the resume:
{
  "name": "...",
  "email": "...",
  "phone": "...",
  "location": "...",
  "summary": "...",
  "skills": ["list", "of", "skills"],
  "experience": [{"company": "...", "title": "...", "startDate": "...", "endDate": "...", "description": "..."}],
  "education": [{"institution": "...", "degree": "...", "field": "...", "startDate": "...", "endDate": "..."}],
  "certifications": [],
  "languages": [],
  "projects": []
}

Resume:
${rawText.slice(0, 4000)}

{`;
}

/**
 * Attempt 3 — absolute minimal schema, only scalar fields and flat skill list.
 */
function buildMinimalPrompt(rawText: string): string {
  return `Extract data from this resume. Return ONLY valid JSON. Nothing else. Start with {

{
  "name": "person full name",
  "email": "their email",
  "phone": "their phone",
  "location": "their city",
  "summary": "one sentence about them",
  "skills": ["skill1", "skill2", "skill3"],
  "experience": [],
  "education": [],
  "certifications": [],
  "languages": [],
  "projects": []
}

Resume text:
${rawText.slice(0, 3000)}

JSON:
{`;
}

// ── Response text extraction ─────────────────────────────────────────────────

/**
 * Extracts plain text from an Ollama /api/generate response.
 *
 * Ollama native /api/generate returns:
 *   { "model": "...", "response": "...", "done": true, ... }
 *
 * OpenAI-compat /v1/completions returns:
 *   { "choices": [{ "text": "..." }] }
 */
function extractResponseText(data: unknown): string {
  if (!data) return '';
  if (typeof data === 'string') return data;

  const d = data as Record<string, unknown>;

  // ── Native Ollama /api/generate (primary path) ──
  if (typeof d.response === 'string' && d.response.length > 0) {
    return d.response;
  }

  // ── OpenAI-compat /v1/completions ──
  const choices = d.choices as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0];
    if (typeof first.text === 'string' && first.text.length > 0) return first.text;
    const msg = first.message as Record<string, unknown> | undefined;
    if (typeof msg?.content === 'string' && msg.content.length > 0) return msg.content;
  }

  // ── Other shapes ──
  if (typeof d.completion === 'string') return d.completion;
  if (d.output) {
    return Array.isArray(d.output)
      ? (d.output as string[]).join('')
      : String(d.output);
  }

  // Last resort — but this produces the "wrong JSON" bug, so log a warning
  logger.warn('extractResponseText: unknown response shape, falling back to JSON.stringify');
  logger.warn(`Response keys: ${Object.keys(d).join(', ')}`);
  return '';
}

// ── JSON cleaning ─────────────────────────────────────────────────────────────

/**
 * Aggressively cleans a raw LLM response to extract a valid JSON object.
 *
 * Handles:
 * - Markdown code fences (```json ... ```)
 * - Leading prose before the first {
 * - Trailing prose after the last }
 * - Model prefixing the output with "JSON:" or "Output:"
 * - Prompt echo (when model repeats the prompt before answering)
 */
function cleanAndExtractJson(raw: string): string {
  if (!raw || raw.trim() === '') return '';

  let text = raw
    // Strip markdown fences
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/gi, '')
    // Strip common prefixes the model might add
    .replace(/^(json\s*[:=]?\s*|output\s*[:=]?\s*|result\s*[:=]?\s*|here\s+is\s+.*?:\s*)/i, '')
    .trim();

  // If prompt was echoed back, find where the actual JSON starts
  // (the model sometimes repeats "JSON output:" before giving the answer)
  const jsonOutputIdx = text.lastIndexOf('JSON output:');
  if (jsonOutputIdx !== -1) {
    text = text.slice(jsonOutputIdx + 'JSON output:'.length).trim();
  }
  const jsonColonIdx = text.lastIndexOf('JSON:');
  if (jsonColonIdx !== -1) {
    text = text.slice(jsonColonIdx + 'JSON:'.length).trim();
  }

  // Fast path — already valid JSON
  try {
    JSON.parse(text);
    return text;
  } catch { /* continue */ }

  // Find the outermost { ... } block
  const firstBrace = text.indexOf('{');
  const lastBrace  = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = text.slice(firstBrace, lastBrace + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch { /* continue */ }

    // Attempt repair: remove trailing comma before closing brace/bracket
    const repaired = candidate
      .replace(/,\s*}/g, '}')
      .replace(/,\s*]/g, ']');
    try {
      JSON.parse(repaired);
      return repaired;
    } catch { /* continue */ }
  }

  return text; // Return cleaned text even if still invalid — caller will handle
}

// ── Main exported function ───────────────────────────────────────────────────

export interface OllamaParseResult {
  parsedJson: Record<string, unknown>;
  llmAttempts: number;
  rawText: string;
}

export async function parseResumeWithOllama(
  rawText: string,
  ollamaUrl: string,
  model: string,
): Promise<OllamaParseResult> {
  let lastError = '';

  const prompts = [
    buildInitialPrompt(rawText),
    buildRetryPrompt(rawText, lastError),
    buildMinimalPrompt(rawText),
  ];

  for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt++) {
    // On retry attempts, update the second prompt with the actual error
    if (attempt === 2) prompts[1] = buildRetryPrompt(rawText, lastError);

    const prompt = prompts[attempt - 1];

    logger.log(`Ollama attempt ${attempt}/${LLM_MAX_ATTEMPTS} — model: ${model}`);

    let responseText = '';

    try {
      // ── Use native /api/generate endpoint ──────────────────────────────
      // This endpoint works reliably across ALL Ollama models including phi,
      // mistral, llama2, gemma etc. The OpenAI-compat /v1/completions has
      // inconsistent response shapes across models and causes the "wrong JSON"
      // bug where extractText falls through to JSON.stringify(wholeResponse).
      const response = await axios.post(
        `${ollamaUrl}/api/generate`,
        {
          model,
          prompt,
          stream: false,           // get the full response in one shot
          options: {
            temperature: 0,        // deterministic — we want structured output
            num_predict: attempt < 3 ? 1800 : 700,
            stop: ['\n```', '```'], // stop if model tries to add code fences
          },
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 300_000, // 5 min — phi/mistral can be slow on CPU
        },
      );

      responseText = extractResponseText(response.data);

      if (!responseText) {
        lastError = 'Ollama returned empty response text';
        logger.warn(`[Attempt ${attempt}] Empty response. Raw data keys: ${Object.keys(response.data ?? {}).join(', ')}`);

        if (attempt < LLM_MAX_ATTEMPTS) {
          await delay(2000 * attempt);
          continue;
        }
      }
    } catch (err) {
      const axiosErr = err as AxiosError;
      lastError = axiosErr.message ?? String(err);
      logger.warn(`Ollama HTTP error on attempt ${attempt}: ${lastError}`);

      if (attempt === LLM_MAX_ATTEMPTS) {
        throw new Error(`Ollama unreachable after ${LLM_MAX_ATTEMPTS} attempts: ${lastError}`);
      }
      await delay(2000 * attempt);
      continue;
    }

    // ── Try to parse the JSON from the response ──────────────────────────
    const cleaned = cleanAndExtractJson(responseText);

    logger.log(`[Attempt ${attempt}] Response length: ${responseText.length}, cleaned: ${cleaned.slice(0, 120)}`);

    try {
      const parsedJson = JSON.parse(cleaned) as Record<string, unknown>;

      // Sanity check — make sure it's actually a resume object, not some
      // other JSON the model returned (e.g. {"error": "..."})
      const hasResumeFields =
        'name' in parsedJson ||
        'email' in parsedJson ||
        'skills' in parsedJson ||
        'experience' in parsedJson;

      if (!hasResumeFields && attempt < LLM_MAX_ATTEMPTS) {
        lastError = 'Parsed JSON does not contain expected resume fields';
        logger.warn(`[Attempt ${attempt}] ${lastError} — keys: ${Object.keys(parsedJson).join(', ')}`);
        await delay(2000 * attempt);
        continue;
      }

      logger.log(`Ollama parse succeeded on attempt ${attempt}`);
      return { parsedJson, llmAttempts: attempt, rawText };

    } catch (parseErr) {
      lastError = (parseErr as Error).message;
      logger.warn(
        `[Attempt ${attempt}] JSON.parse failed: ${lastError}\n` +
        `Cleaned snippet: ${cleaned.slice(0, 300)}`,
      );

      if (attempt === LLM_MAX_ATTEMPTS) {
        // ── Absolute last resort fallback ────────────────────────────────
        // Store a skeleton so the resume is never completely lost.
        // The frontend shows a warning banner when _parseError is present.
        logger.warn('All LLM attempts failed — storing partial fallback JSON');
        return {
          parsedJson: {
            _parseError: `LLM returned invalid JSON after ${LLM_MAX_ATTEMPTS} attempts. Last error: ${lastError}`,
            _rawLlmOutput: responseText.slice(0, 800),
            name: null,
            email: null,
            phone: null,
            location: null,
            summary: null,
            skills: [],
            experience: [],
            education: [],
            certifications: [],
            languages: [],
            projects: [],
          },
          llmAttempts: attempt,
          rawText,
        };
      }

      await delay(2000 * attempt);
    }
  }

  throw new Error('Unexpected exit from Ollama retry loop');
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
