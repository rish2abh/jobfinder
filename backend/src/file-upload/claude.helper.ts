import axios from 'axios';
import { Logger } from '@nestjs/common';
import { LLM_MAX_ATTEMPTS } from './resume-job.types';

const logger = new Logger('ClaudeHelper');

export interface ClaudeParseResult {
  parsedJson: Record<string, unknown>;
  llmAttempts: number;
  rawText: string;
}

/**
 * Parse resume text using the Anthropic Claude API.
 * Uses the Messages API with structured JSON output.
 */
export async function parseResumeWithClaude(
  rawText: string,
  apiKey: string,
  model?: string,
): Promise<ClaudeParseResult> {
  const claudeModel = model || 'claude-sonnet-4-20250514';
  const claudeApiUrl = 'https://api.anthropic.com/v1/messages';

  const systemPrompt = `You are a resume data extractor. You ONLY output valid JSON — no markdown, no explanation, no code fences. Output a single JSON object with these exact keys:
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
Use null for missing fields, never omit a key.`;

  let lastError = '';

  for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt++) {
    logger.log(`Claude attempt ${attempt}/${LLM_MAX_ATTEMPTS} — model: ${claudeModel}`);

    const userMessage = attempt === 1
      ? `Parse this resume and return ONLY the JSON object:\n\n${rawText.slice(0, 8000)}`
      : `PREVIOUS ATTEMPT FAILED: ${lastError}\n\nTry again. Output ONLY valid JSON.\n\nResume:\n${rawText.slice(0, 6000)}`;

    const startTime = Date.now();
    try {
      const response = await axios.post(
        claudeApiUrl,
        {
          model: claudeModel,
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          timeout: 120_000,
        },
      );

      const elapsed = Date.now() - startTime;
      logger.log(
        `[Claude] resume-parse — success — elapsed: ${elapsed}ms, status: ${response.status}`,
      );

      // Extract text from Claude response
      const content = response.data?.content;
      let responseText = '';
      if (Array.isArray(content)) {
        const textBlock = content.find((b: any) => b.type === 'text');
        responseText = textBlock?.text ?? '';
      }

      if (!responseText) {
        lastError = 'Claude returned empty response';
        logger.warn(`[Attempt ${attempt}] Empty response from Claude`);
        if (attempt < LLM_MAX_ATTEMPTS) {
          await delay(1000 * attempt);
          continue;
        }
      }

      // Clean and parse JSON
      const cleaned = cleanAndExtractJson(responseText);

      try {
        const parsedJson = JSON.parse(cleaned) as Record<string, unknown>;

        const hasResumeFields =
          'name' in parsedJson ||
          'email' in parsedJson ||
          'skills' in parsedJson ||
          'experience' in parsedJson;

        if (!hasResumeFields && attempt < LLM_MAX_ATTEMPTS) {
          lastError = 'Parsed JSON does not contain expected resume fields';
          logger.warn(`[Attempt ${attempt}] ${lastError}`);
          await delay(1000 * attempt);
          continue;
        }

        logger.log(`Claude parse succeeded on attempt ${attempt}`);
        return { parsedJson, llmAttempts: attempt, rawText };
      } catch (parseErr) {
        lastError = (parseErr as Error).message;
        logger.warn(`[Attempt ${attempt}] JSON.parse failed: ${lastError}`);

        if (attempt === LLM_MAX_ATTEMPTS) {
          logger.warn('All Claude attempts failed — storing partial fallback JSON');
          return {
            parsedJson: {
              _parseError: `Claude returned invalid JSON after ${LLM_MAX_ATTEMPTS} attempts. Last error: ${lastError}`,
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

        await delay(1000 * attempt);
      }
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      const status = err?.response?.status;
      lastError = err.message ?? String(err);
      logger.error(
        `[Claude] resume-parse — failed — elapsed: ${elapsed}ms` +
        `${status ? `, status: ${status}` : ''}, error: ${lastError}`,
        err?.stack,
      );

      if (attempt === LLM_MAX_ATTEMPTS) {
        throw new Error(`Claude API failed after ${LLM_MAX_ATTEMPTS} attempts: ${lastError}`);
      }
      await delay(2000 * attempt);
    }
  }

  throw new Error('Unexpected exit from Claude retry loop');
}

/**
 * Clean LLM response to extract valid JSON.
 */
function cleanAndExtractJson(raw: string): string {
  if (!raw || raw.trim() === '') return '';

  let text = raw
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/gi, '')
    .trim();

  // Fast path
  try {
    JSON.parse(text);
    return text;
  } catch { /* continue */ }

  // Find outermost { ... }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = text.slice(firstBrace, lastBrace + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch { /* continue */ }

    const repaired = candidate
      .replace(/,\s*}/g, '}')
      .replace(/,\s*]/g, ']');
    try {
      JSON.parse(repaired);
      return repaired;
    } catch { /* continue */ }
  }

  return text;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
