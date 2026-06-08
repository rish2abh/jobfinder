import axios from 'axios';
import { Logger } from '@nestjs/common';
import { LLM_MAX_ATTEMPTS } from './resume-job.types';

const logger = new Logger('LlamaParseHelper');

const LLAMAPARSE_API_URL = 'https://api.cloud.llamaindex.ai/api/parsing';

export interface LlamaParseResult {
  parsedJson: Record<string, unknown>;
  llmAttempts: number;
  rawText: string;
}

/**
 * Parse resume using LlamaParse API (LlamaIndex Cloud).
 *
 * LlamaParse excels at structured document extraction from PDFs.
 * It handles tables, multi-column layouts, and complex formatting better
 * than raw text extraction + LLM.
 *
 * Flow:
 *   1. Upload PDF buffer to LlamaParse → get job ID
 *   2. Poll for completion
 *   3. Retrieve structured result as JSON
 *
 * Since we already have rawText from pdf-parse, we use LlamaParse's
 * text-to-structured-JSON mode to parse the resume text into fields.
 */
export async function parseResumeWithLlamaParse(
  rawText: string,
  pdfBase64: string | undefined,
  apiKey: string,
): Promise<LlamaParseResult> {
  if (!apiKey) {
    throw new Error('LLAMAPARSE_API_KEY environment variable is not configured');
  }

  // If we have the PDF buffer, use the upload endpoint for best results.
  // Otherwise fall back to parsing the raw text via the text endpoint.
  if (pdfBase64) {
    return parseWithPdfUpload(pdfBase64, apiKey, rawText);
  }

  return parseWithTextInput(rawText, apiKey);
}

/**
 * Upload PDF binary to LlamaParse for structured extraction.
 */
async function parseWithPdfUpload(
  pdfBase64: string,
  apiKey: string,
  rawText: string,
): Promise<LlamaParseResult> {
  const pdfBuffer = Buffer.from(pdfBase64, 'base64');

  for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt++) {
    logger.log(`LlamaParse attempt ${attempt}/${LLM_MAX_ATTEMPTS} — PDF upload mode`);
    const startTime = Date.now();

    try {
      // Step 1: Upload the PDF
      const FormData = (await import('form-data')).default;
      const form = new FormData();
      form.append('file', pdfBuffer, {
        filename: 'resume.pdf',
        contentType: 'application/pdf',
      });
      form.append('parsing_instruction', PARSING_INSTRUCTION);
      form.append('result_type', 'json');

      const uploadResponse = await axios.post(
        `${LLAMAPARSE_API_URL}/upload`,
        form,
        {
          headers: {
            ...form.getHeaders(),
            'Authorization': `Bearer ${apiKey}`,
          },
          timeout: 30_000,
        },
      );

      const jobId = uploadResponse.data?.id;
      if (!jobId) {
        throw new Error('LlamaParse upload did not return a job ID');
      }

      logger.log(`LlamaParse job created: ${jobId}`);

      // Step 2: Poll for completion
      const result = await pollForCompletion(jobId, apiKey);
      const elapsed = Date.now() - startTime;

      logger.log(
        `[LlamaParse] resume-parse — success — elapsed: ${elapsed}ms`,
      );

      // Step 3: Extract structured JSON from LlamaParse result
      const parsedJson = extractResumeFromLlamaParseResult(result);

      return { parsedJson, llmAttempts: attempt, rawText };
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      const status = err?.response?.status;
      logger.error(
        `[LlamaParse] resume-parse — failed — elapsed: ${elapsed}ms` +
        `${status ? `, status: ${status}` : ''}, error: ${err.message}`,
        err?.stack,
      );

      if (attempt === LLM_MAX_ATTEMPTS) {
        throw new Error(`LlamaParse failed after ${LLM_MAX_ATTEMPTS} attempts: ${err.message}`);
      }
      await delay(2000 * attempt);
    }
  }

  throw new Error('Unexpected exit from LlamaParse retry loop');
}

/**
 * Fallback: send raw text to LlamaParse for structuring.
 * Uses the job endpoint with inline text content.
 */
async function parseWithTextInput(
  rawText: string,
  apiKey: string,
): Promise<LlamaParseResult> {
  for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt++) {
    logger.log(`LlamaParse attempt ${attempt}/${LLM_MAX_ATTEMPTS} — text input mode`);
    const startTime = Date.now();

    try {
      const FormData = (await import('form-data')).default;
      const form = new FormData();
      // Create a text file buffer from the raw text
      const textBuffer = Buffer.from(rawText, 'utf-8');
      form.append('file', textBuffer, {
        filename: 'resume.txt',
        contentType: 'text/plain',
      });
      form.append('parsing_instruction', PARSING_INSTRUCTION);
      form.append('result_type', 'json');

      const uploadResponse = await axios.post(
        `${LLAMAPARSE_API_URL}/upload`,
        form,
        {
          headers: {
            ...form.getHeaders(),
            'Authorization': `Bearer ${apiKey}`,
          },
          timeout: 30_000,
        },
      );

      const jobId = uploadResponse.data?.id;
      if (!jobId) {
        throw new Error('LlamaParse upload did not return a job ID');
      }

      const result = await pollForCompletion(jobId, apiKey);
      const elapsed = Date.now() - startTime;

      logger.log(`[LlamaParse] text-parse — success — elapsed: ${elapsed}ms`);

      const parsedJson = extractResumeFromLlamaParseResult(result);
      return { parsedJson, llmAttempts: attempt, rawText };
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      logger.error(
        `[LlamaParse] text-parse — failed — elapsed: ${elapsed}ms, error: ${err.message}`,
        err?.stack,
      );

      if (attempt === LLM_MAX_ATTEMPTS) {
        throw new Error(`LlamaParse text mode failed after ${LLM_MAX_ATTEMPTS} attempts: ${err.message}`);
      }
      await delay(2000 * attempt);
    }
  }

  throw new Error('Unexpected exit from LlamaParse text retry loop');
}

/**
 * Poll LlamaParse job status until completion or failure.
 */
async function pollForCompletion(jobId: string, apiKey: string): Promise<any> {
  const maxPolls = 60; // up to 2 minutes at 2s intervals
  const pollInterval = 2000;

  for (let i = 0; i < maxPolls; i++) {
    await delay(pollInterval);

    const statusResponse = await axios.get(
      `${LLAMAPARSE_API_URL}/job/${jobId}`,
      {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        timeout: 10_000,
      },
    );

    const status = statusResponse.data?.status;

    if (status === 'SUCCESS') {
      // Fetch the result
      const resultResponse = await axios.get(
        `${LLAMAPARSE_API_URL}/job/${jobId}/result/json`,
        {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          timeout: 30_000,
        },
      );
      return resultResponse.data;
    }

    if (status === 'ERROR' || status === 'FAILED') {
      throw new Error(`LlamaParse job ${jobId} failed with status: ${status}`);
    }

    // Still PENDING or PROCESSING — keep polling
    logger.debug(`LlamaParse job ${jobId} status: ${status}, poll #${i + 1}`);
  }

  throw new Error(`LlamaParse job ${jobId} timed out after ${maxPolls * pollInterval / 1000}s`);
}

/**
 * Extract resume fields from LlamaParse structured output.
 * LlamaParse returns pages with structured content — we normalize to our schema.
 */
function extractResumeFromLlamaParseResult(result: any): Record<string, unknown> {
  // LlamaParse JSON result can come in different shapes depending on config.
  // Try to find structured resume data or fall back to extracting from pages.

  // If result is already a resume-shaped object
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    if ('name' in result || 'email' in result || 'skills' in result) {
      return normalizeResumeFields(result);
    }
  }

  // If result has pages array (common LlamaParse format)
  if (Array.isArray(result?.pages)) {
    const allText = result.pages
      .map((p: any) => p.text || p.content || '')
      .join('\n');

    // Try to parse as JSON if LlamaParse already structured it
    try {
      const parsed = JSON.parse(allText);
      if ('name' in parsed || 'email' in parsed) {
        return normalizeResumeFields(parsed);
      }
    } catch { /* not JSON, return as raw text structure */ }

    // Return a basic structure with the extracted text
    return {
      name: null,
      email: null,
      phone: null,
      location: null,
      summary: allText.slice(0, 500),
      skills: [],
      experience: [],
      education: [],
      certifications: [],
      languages: [],
      projects: [],
      _llamaparseRaw: allText.slice(0, 2000),
    };
  }

  // If result is an array of objects (structured extraction)
  if (Array.isArray(result)) {
    const combined = result.reduce((acc: any, item: any) => ({ ...acc, ...item }), {});
    return normalizeResumeFields(combined);
  }

  // Last resort — return what we got
  return normalizeResumeFields(result || {});
}

/**
 * Normalize resume fields to our expected schema.
 */
function normalizeResumeFields(data: Record<string, unknown>): Record<string, unknown> {
  return {
    name: data.name ?? null,
    email: data.email ?? null,
    phone: data.phone ?? data.phone_number ?? null,
    location: data.location ?? data.address ?? null,
    summary: data.summary ?? data.bio ?? data.objective ?? null,
    skills: Array.isArray(data.skills) ? data.skills : [],
    experience: Array.isArray(data.experience) ? data.experience : [],
    education: Array.isArray(data.education) ? data.education : [],
    certifications: Array.isArray(data.certifications) ? data.certifications : [],
    languages: Array.isArray(data.languages) ? data.languages : [],
    projects: Array.isArray(data.projects) ? data.projects : [],
  };
}

const PARSING_INSTRUCTION = `Extract structured resume data from this document. Return a JSON object with these fields:
- name (string)
- email (string)
- phone (string)
- location (string)
- summary (string - professional summary)
- skills (array of strings)
- experience (array of objects with: company, title, startDate, endDate, description)
- education (array of objects with: institution, degree, field, startDate, endDate)
- certifications (array of strings)
- languages (array of strings)
- projects (array of objects with: name, description, technologies)`;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
