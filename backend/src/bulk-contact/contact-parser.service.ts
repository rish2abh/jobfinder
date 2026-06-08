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

    const nameHeaders = ['name', 'full name', 'fullname', 'contact name', 'contact_name', 'person', 'person name'];
    const emailHeaders = ['email', 'e-mail', 'email address', 'email_address', 'mail', 'emailid', 'email id', 'e mail'];
    const titleHeaders = ['title', 'job title', 'job_title', 'role', 'position', 'designation', 'jobtitle'];
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

    return normalized;
  }

  /**
   * Extract structured contacts from plain text (PDF/DOCX).
   * Uses regex patterns to find email addresses and surrounding context.
   */
  private parseTextToContacts(text: string): ParseResult {
    const contacts: ParsedContact[] = [];
    const skipped: { row: number; reason: string }[] = [];

    // Strategy: split text into lines and find emails, then try to extract context
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

    const emailRegex = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
    const seenEmails = new Set<string>();
    let entryIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const emailMatches = line.match(emailRegex);

      if (!emailMatches) continue;

      for (const email of emailMatches) {
        if (seenEmails.has(email.toLowerCase())) continue;
        seenEmails.add(email.toLowerCase());
        entryIndex++;

        // Try to extract name from surrounding lines
        const name = this.extractNameFromContext(lines, i, email);
        const title = this.extractFieldFromContext(lines, i, ['title', 'role', 'position', 'designation']);
        const company = this.extractFieldFromContext(lines, i, ['company', 'organization', 'organisation', 'employer']);

        // If name not found, derive from email
        const finalName = name || this.deriveNameFromEmail(email);

        contacts.push({
          name: finalName,
          email,
          title: title || undefined,
          company: company || undefined,
        });
      }
    }

    return { contacts, skipped };
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
