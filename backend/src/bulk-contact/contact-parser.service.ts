import { BadRequestException, Injectable } from '@nestjs/common';
import { Readable } from 'stream';
import csvParser = require('csv-parser');
import pdfParse = require('pdf-parse');
import mammoth = require('mammoth');

export interface ParsedContact {
  name: string;
  email: string;
  title?: string;
  company?: string;
}

export interface ParseResult {
  contacts: ParsedContact[];
  skipped: { row: number; reason: string }[];
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const SUPPORTED_MIMETYPES = [
  'text/csv',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
];

@Injectable()
export class ContactParserService {
  /**
   * Main entry point — routes to the correct parser based on mimetype.
   */
  async parse(buffer: Buffer, mimetype: string, originalName: string): Promise<ParseResult> {
    if (buffer.length > MAX_FILE_SIZE) {
      throw new BadRequestException(
        `File exceeds maximum size of 10MB (received ${(buffer.length / 1024 / 1024).toFixed(2)}MB)`,
      );
    }

    if (!SUPPORTED_MIMETYPES.includes(mimetype)) {
      throw new BadRequestException(
        `Unsupported file format: ${mimetype}. Accepted formats: CSV, PDF, DOCX`,
      );
    }

    if (mimetype === 'text/csv') {
      return this.parseCSV(buffer);
    }

    if (mimetype === 'application/pdf') {
      return this.parsePDF(buffer);
    }

    // DOCX or DOC
    return this.parseDOCX(buffer);
  }

  /**
   * Parse a CSV buffer expecting columns: name, email, title, company.
   * Column matching is case-insensitive and trims whitespace.
   */
  async parseCSV(buffer: Buffer): Promise<ParseResult> {
    const contacts: ParsedContact[] = [];
    const skipped: { row: number; reason: string }[] = [];

    const rows = await this.csvToRows(buffer);

    rows.forEach((row, index) => {
      const normalized = this.normalizeCSVRow(row);
      const name = normalized.name?.trim();
      const email = normalized.email?.trim();
      const title = normalized.title?.trim() || undefined;
      const company = normalized.company?.trim() || undefined;

      if (!name && !email) {
        skipped.push({ row: index + 1, reason: 'Missing both name and email' });
        return;
      }
      if (!email) {
        skipped.push({ row: index + 1, reason: 'Missing email' });
        return;
      }

      // If name is missing, derive it from the email address (before @)
      const finalName = name || this.deriveNameFromEmail(email);

      contacts.push({ name: finalName, email, title, company });
    });

    return { contacts, skipped };
  }

  /**
   * Parse a PDF buffer by extracting text and using regex to find contacts.
   */
  async parsePDF(buffer: Buffer): Promise<ParseResult> {
    const data = await pdfParse(buffer);
    const text = data.text || '';
    return this.parseTextToContacts(text);
  }

  /**
   * Parse a DOCX buffer by converting to text via mammoth, then extracting contacts.
   */
  async parseDOCX(buffer: Buffer): Promise<ParseResult> {
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value || '';
    return this.parseTextToContacts(text);
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private csvToRows(buffer: Buffer): Promise<Record<string, string>[]> {
    return new Promise((resolve, reject) => {
      const rows: Record<string, string>[] = [];
      // Strip UTF-8 BOM if present
      let content = buffer.toString('utf-8');
      if (content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
      }
      const stream = Readable.from(content);

      stream
        .pipe(csvParser())
        .on('data', (row) => rows.push(row))
        .on('end', () => resolve(rows))
        .on('error', (err) => reject(err));
    });
  }

  /**
   * Normalize CSV row keys to lowercase and map common header variations.
   * Also handles positional fallback when headers don't match known names.
   */
  private normalizeCSVRow(row: Record<string, string>): Record<string, string> {
    const normalized: Record<string, string> = {};

    const nameHeaders = ['name', 'full name', 'fullname', 'contact name', 'contact_name', 'person', 'person name', 'contact'];
    const emailHeaders = ['email', 'e-mail', 'email address', 'email_address', 'mail', 'emailid', 'email id', 'e mail'];
    const titleHeaders = ['title', 'job title', 'job_title', 'role', 'position', 'designation', 'jobtitle', 'job role'];
    const companyHeaders = ['company', 'organization', 'organisation', 'company name', 'company_name', 'employer', 'org'];
    const skipHeaders = ['sno', 's.no', 'sr.no', 'sr no', 'serial', 'serial no', 'no', '#', 'sl', 'sl.no', 'sl no', 'id', 'index'];

    for (const [key, value] of Object.entries(row)) {
      const lowerKey = key.toLowerCase().trim();

      if (nameHeaders.includes(lowerKey)) {
        normalized.name = value;
      } else if (emailHeaders.includes(lowerKey)) {
        normalized.email = value;
      } else if (titleHeaders.includes(lowerKey)) {
        normalized.title = value;
      } else if (companyHeaders.includes(lowerKey)) {
        normalized.company = value;
      }
    }

    // Fallback: if name/email not found via headers, try positional detection.
    // Skip serial number columns and columns that already mapped to known fields.
    if (!normalized.name || !normalized.email) {
      const mappedKeys = new Set<string>();

      // Track which keys were already mapped
      for (const [key] of Object.entries(row)) {
        const lowerKey = key.toLowerCase().trim();
        if (nameHeaders.includes(lowerKey) || emailHeaders.includes(lowerKey) ||
            titleHeaders.includes(lowerKey) || companyHeaders.includes(lowerKey) ||
            skipHeaders.includes(lowerKey)) {
          mappedKeys.add(key);
        }
      }

      const unmappedValues = Object.entries(row).filter(([key]) => !mappedKeys.has(key));

      for (const [, value] of unmappedValues) {
        const trimmedValue = (value || '').trim();
        if (!trimmedValue) continue;

        // Detect email by content pattern
        if (!normalized.email && /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(trimmedValue)) {
          normalized.email = trimmedValue;
          continue;
        }

        // Detect name: first non-email, non-numeric text that looks like a person's name
        if (!normalized.name && !trimmedValue.includes('@') && !/^\d+$/.test(trimmedValue)) {
          if (/^[A-Za-z\s.''\-]+$/.test(trimmedValue) && trimmedValue.length >= 2 && trimmedValue.length <= 100) {
            normalized.name = trimmedValue;
          }
        }
      }
    }

    // Fallback: if title/company not found via headers, attempt positional inference.
    // After name and email are resolved, remaining unmapped non-numeric fields
    // are assumed to be title (first remaining) and company (second remaining).
    if (!normalized.title || !normalized.company) {
      const allValues = Object.entries(row);
      const resolvedValues = new Set([
        normalized.name?.toLowerCase(),
        normalized.email?.toLowerCase(),
        normalized.title?.toLowerCase(),
        normalized.company?.toLowerCase(),
      ].filter(Boolean));

      const remaining: string[] = [];
      for (const [key, value] of allValues) {
        const lowerKey = key.toLowerCase().trim();
        const trimmedValue = (value || '').trim();
        if (!trimmedValue) continue;
        if (skipHeaders.includes(lowerKey)) continue;
        if (/^\d+$/.test(trimmedValue)) continue;
        if (resolvedValues.has(trimmedValue.toLowerCase())) continue;
        if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(trimmedValue)) continue;
        remaining.push(trimmedValue);
      }

      if (!normalized.title && remaining.length > 0) {
        normalized.title = remaining[0];
      }
      if (!normalized.company && remaining.length > 1) {
        normalized.company = remaining[1];
      }
    }

    return normalized;
  }

  /**
   * Extract structured contacts from plain text (PDF/DOCX).
   * Uses regex patterns to find email addresses and surrounding context.
   *
   * Strategy:
   * 1. Detect if text is tabular (pipe/comma/tab-delimited with a header row)
   * 2. If tabular, use column positions to extract fields
   * 3. Otherwise, fall back to label-based extraction from nearby lines
   */
  private parseTextToContacts(text: string): ParseResult {
    const contacts: ParsedContact[] = [];
    const skipped: { row: number; reason: string }[] = [];

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

    // ── Try tabular parsing first ───────────────────────────────────────────
    const tabularResult = this.tryParseTabular(lines);
    if (tabularResult && tabularResult.length > 0) {
      const seenEmails = new Set<string>();
      for (const entry of tabularResult) {
        if (!entry.email) continue;
        const emailLower = entry.email.toLowerCase();
        if (seenEmails.has(emailLower)) continue;
        seenEmails.add(emailLower);
        contacts.push(entry);
      }
      return { contacts, skipped };
    }

    // ── Fallback: line-by-line email detection ──────────────────────────────
    const emailRegex = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
    const seenEmails = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const emailMatches = line.match(emailRegex);

      if (!emailMatches) continue;

      for (const email of emailMatches) {
        if (seenEmails.has(email.toLowerCase())) continue;
        seenEmails.add(email.toLowerCase());

        // Try to extract name from surrounding lines
        const name = this.extractNameFromContext(lines, i, email);
        const title = this.extractFieldFromContext(lines, i, ['title', 'role', 'position', 'designation']);
        const company = this.extractFieldFromContext(lines, i, ['company', 'organization', 'organisation', 'employer']);

        // Try positional extraction from the same delimited line
        const positional = this.extractFieldsFromDelimitedLine(lines[i], email);

        const finalName = name || positional.name || this.deriveNameFromEmail(email);
        const finalTitle = title || positional.title || undefined;
        const finalCompany = company || positional.company || undefined;

        contacts.push({
          name: finalName,
          email,
          title: finalTitle,
          company: finalCompany,
        });
      }
    }

    return { contacts, skipped };
  }

  /**
   * Detect if lines form a tabular structure (with headers) and parse accordingly.
   * Returns null if not tabular.
   */
  private tryParseTabular(lines: string[]): ParsedContact[] | null {
    if (lines.length < 2) return null;

    // Detect delimiter: pipe, tab, comma, or multiple spaces (common in PDF tables)
    const delimiters = ['|', '\t', ',', /\s{2,}/];
    let delimiter: string | RegExp | null = null;
    let headerLine = '';
    let headerIdx = -1;

    // Known header keywords (all lowercase for comparison)
    const allKnownHeaders = [
      'name', 'full name', 'fullname', 'contact name', 'person', 'contact',
      'email', 'e-mail', 'email address', 'mail', 'emailid', 'email id',
      'title', 'job title', 'job_title', 'role', 'position', 'designation', 'jobtitle',
      'company', 'organization', 'organisation', 'employer', 'org', 'company name',
      'sno', 's.no', 'sr.no', 'sr no', 'serial', 'no', '#', 'sl', 'sl.no', 'id', 'index',
    ];

    for (let i = 0; i < Math.min(5, lines.length); i++) {
      for (const d of delimiters) {
        const parts = typeof d === 'string'
          ? lines[i].split(d).map((p) => p.trim()).filter((p) => p.length > 0)
          : lines[i].split(d).map((p) => p.trim()).filter((p) => p.length > 0);
        if (parts.length >= 3) {
          // Check if this looks like a header row: at least 2 parts match known header keywords
          const lowerParts = parts.map((p) => p.toLowerCase().trim());
          const matchCount = lowerParts.filter((p) => allKnownHeaders.includes(p)).length;
          if (matchCount >= 2) {
            delimiter = d;
            headerLine = lines[i];
            headerIdx = i;
            break;
          }
        }
      }
      if (delimiter) break;
    }

    if (!delimiter || headerIdx === -1) return null;

    // Map column indices — use lowercase comparison
    const splitLine = (line: string) =>
      typeof delimiter === 'string'
        ? line.split(delimiter).map((h) => h.trim()).filter((h) => h.length > 0)
        : line.split(delimiter as RegExp).map((h) => h.trim()).filter((h) => h.length > 0);

    const headers = splitLine(headerLine).map((h) => h.toLowerCase());
    const nameHeaders = ['name', 'full name', 'fullname', 'contact name', 'person', 'contact'];
    const emailHeaders = ['email', 'e-mail', 'email address', 'mail', 'emailid', 'email id'];
    const titleHeaders = ['title', 'job title', 'job_title', 'role', 'position', 'designation', 'jobtitle'];
    const companyHeaders = ['company', 'organization', 'organisation', 'employer', 'org', 'company name'];

    let nameIdx = -1, emailIdx = -1, titleIdx = -1, companyIdx = -1;

    headers.forEach((h, idx) => {
      if (nameIdx === -1 && nameHeaders.includes(h)) nameIdx = idx;
      if (emailIdx === -1 && emailHeaders.includes(h)) emailIdx = idx;
      if (titleIdx === -1 && titleHeaders.includes(h)) titleIdx = idx;
      if (companyIdx === -1 && companyHeaders.includes(h)) companyIdx = idx;
    });

    if (emailIdx === -1) return null; // Must have at least an email column

    const contacts: ParsedContact[] = [];
    const emailRegex = /^[\w.+-]+@[\w-]+\.[\w.-]+$/;

    for (let i = headerIdx + 1; i < lines.length; i++) {
      const parts = splitLine(lines[i]);
      if (parts.length <= emailIdx) continue;

      const email = parts[emailIdx]?.trim();
      if (!email || !emailRegex.test(email)) continue;

      const name = nameIdx >= 0 && parts.length > nameIdx ? parts[nameIdx]?.trim() : '';
      const title = titleIdx >= 0 && parts.length > titleIdx ? parts[titleIdx]?.trim() : '';
      const company = companyIdx >= 0 && parts.length > companyIdx ? parts[companyIdx]?.trim() : '';

      contacts.push({
        name: name || this.deriveNameFromEmail(email),
        email,
        title: title || undefined,
        company: company || undefined,
      });
    }

    return contacts.length > 0 ? contacts : null;
  }

  /**
   * Extract fields from a delimited line by position heuristics.
   * Handles formats like: "John Doe | john@x.com | Engineer | Google"
   * or "John Doe, john@x.com, Engineer, Google"
   */
  private extractFieldsFromDelimitedLine(
    line: string,
    email: string,
  ): { name: string | null; title: string | null; company: string | null } {
    // Try common delimiters
    const delimiters = ['|', '\t', ','];
    for (const d of delimiters) {
      const parts = line.split(d).map((p) => p.trim());
      if (parts.length < 3) continue;

      // Find which part is the email
      const emailIdx = parts.findIndex((p) => p.toLowerCase() === email.toLowerCase() || p.includes(email));
      if (emailIdx === -1) continue;

      let name: string | null = null;
      let title: string | null = null;
      let company: string | null = null;

      // Remaining parts (excluding email and serial numbers)
      const otherParts = parts
        .filter((_, idx) => idx !== emailIdx)
        .filter((p) => p.length > 0 && !/^\d+$/.test(p));

      // First non-email part that looks like a name
      for (let j = 0; j < otherParts.length; j++) {
        const part = otherParts[j];
        if (!name && /^[A-Za-z\s.''-]+$/.test(part) && part.length >= 2 && part.length <= 80) {
          name = part;
        } else if (!title && part.length >= 2 && part.length <= 100) {
          // Second meaningful part after name is likely title
          title = part;
        } else if (!company && part.length >= 2 && part.length <= 100) {
          // Third is likely company
          company = part;
        }
      }

      if (name || title || company) {
        return { name, title, company };
      }
    }

    return { name: null, title: null, company: null };
  }

  /**
   * Derive a readable name from an email address.
   * e.g., "john.doe@company.com" → "John Doe"
   */
  private deriveNameFromEmail(email: string): string {
    const localPart = email.split('@')[0] || email;
    // Split on dots, underscores, hyphens and capitalize each word
    const parts = localPart.split(/[._\-+]+/).filter((p) => p.length > 0);
    return parts
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Try to extract a name from context around the email line.
   * Looks at the current line (before the email) and the previous line.
   */
  private extractNameFromContext(lines: string[], emailLineIndex: number, email: string): string | null {
    const currentLine = lines[emailLineIndex];

    // Check if line has a label like "Name: John Doe" pattern
    const nameLabel = currentLine.match(/(?:name|contact)\s*[:\-–]\s*(.+?)(?:\s*[,|;\t]|$)/i);
    if (nameLabel && nameLabel[1].trim() && !nameLabel[1].includes(email)) {
      return nameLabel[1].trim();
    }

    // Check previous line if it looks like a name (no email, no special chars)
    if (emailLineIndex > 0) {
      const prevLine = lines[emailLineIndex - 1];
      if (prevLine && !prevLine.match(/[@]/)) {
        // Looks like a name if it's short-ish and doesn't contain obvious non-name patterns
        const cleaned = prevLine.replace(/[,|;\t]/g, '').trim();
        if (cleaned.length >= 2 && cleaned.length <= 100 && /^[A-Za-z\s.''-]+$/.test(cleaned)) {
          return cleaned;
        }
      }
    }

    // Try to extract name from same line (e.g., "John Doe john@example.com")
    const beforeEmail = currentLine.split(email)[0].trim();
    if (beforeEmail) {
      const cleaned = beforeEmail.replace(/[,|;\t:]/g, '').trim();
      if (cleaned.length >= 2 && cleaned.length <= 100 && /^[A-Za-z\s.''-]+$/.test(cleaned)) {
        return cleaned;
      }
    }

    // Try structured row format: "Name | Email | Title | Company" or "Name, Email, ..."
    const parts = currentLine.split(/[,|\t;]+/).map((p) => p.trim());
    if (parts.length >= 2) {
      const firstPart = parts[0];
      if (firstPart && !firstPart.includes('@') && /^[A-Za-z\s.''-]+$/.test(firstPart) && firstPart.length >= 2) {
        return firstPart;
      }
    }

    return null;
  }

  /**
   * Try to extract a field value from context based on label keywords.
   */
  private extractFieldFromContext(lines: string[], emailLineIndex: number, labels: string[]): string | null {
    // Search current line and nearby lines (±2)
    const start = Math.max(0, emailLineIndex - 2);
    const end = Math.min(lines.length - 1, emailLineIndex + 2);

    for (let i = start; i <= end; i++) {
      const line = lines[i];
      for (const label of labels) {
        const regex = new RegExp(`${label}\\s*[:\\-–]\\s*(.+?)(?:\\s*[,|;\\t]|$)`, 'i');
        const match = line.match(regex);
        if (match && match[1].trim()) {
          return match[1].trim();
        }
      }
    }

    return null;
  }
}
