import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEmail, IsMongoId, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Strips Unicode "fancy" characters (mathematical bold, italic, script, etc.)
 * and normalizes them to plain ASCII equivalents. This handles emails copied
 * from social media / LinkedIn bios that use decorative Unicode text.
 */
const normalizeFancyUnicode = (str: string): string => {
  // Map of Unicode math/fancy character ranges to their ASCII equivalents
  const replacements: Array<[RegExp, (match: string) => string]> = [
    // Mathematical Bold (A-Z: U+1D400–U+1D419, a-z: U+1D41A–U+1D433)
    [/[\u{1D400}-\u{1D419}]/gu, (m) => String.fromCharCode(m.codePointAt(0)! - 0x1D400 + 65)],
    [/[\u{1D41A}-\u{1D433}]/gu, (m) => String.fromCharCode(m.codePointAt(0)! - 0x1D41A + 97)],
    // Mathematical Italic (A-Z: U+1D434–U+1D44D, a-z: U+1D44E–U+1D467)
    [/[\u{1D434}-\u{1D44D}]/gu, (m) => String.fromCharCode(m.codePointAt(0)! - 0x1D434 + 65)],
    [/[\u{1D44E}-\u{1D467}]/gu, (m) => String.fromCharCode(m.codePointAt(0)! - 0x1D44E + 97)],
    // Mathematical Bold Italic (A-Z: U+1D468–U+1D481, a-z: U+1D482–U+1D49B)
    [/[\u{1D468}-\u{1D481}]/gu, (m) => String.fromCharCode(m.codePointAt(0)! - 0x1D468 + 65)],
    [/[\u{1D482}-\u{1D49B}]/gu, (m) => String.fromCharCode(m.codePointAt(0)! - 0x1D482 + 97)],
    // Mathematical Sans-Serif (A-Z: U+1D5A0–U+1D5B9, a-z: U+1D5BA–U+1D5D3)
    [/[\u{1D5A0}-\u{1D5B9}]/gu, (m) => String.fromCharCode(m.codePointAt(0)! - 0x1D5A0 + 65)],
    [/[\u{1D5BA}-\u{1D5D3}]/gu, (m) => String.fromCharCode(m.codePointAt(0)! - 0x1D5BA + 97)],
    // Mathematical Sans-Serif Bold (A-Z: U+1D5D4–U+1D5ED, a-z: U+1D5EE–U+1D607)
    [/[\u{1D5D4}-\u{1D5ED}]/gu, (m) => String.fromCharCode(m.codePointAt(0)! - 0x1D5D4 + 65)],
    [/[\u{1D5EE}-\u{1D607}]/gu, (m) => String.fromCharCode(m.codePointAt(0)! - 0x1D5EE + 97)],
    // Mathematical Sans-Serif Bold Italic (A-Z: U+1D608–U+1D621, a-z: U+1D622–U+1D63B)
    [/[\u{1D608}-\u{1D621}]/gu, (m) => String.fromCharCode(m.codePointAt(0)! - 0x1D608 + 65)],
    [/[\u{1D622}-\u{1D63B}]/gu, (m) => String.fromCharCode(m.codePointAt(0)! - 0x1D622 + 97)],
    // Mathematical Monospace (A-Z: U+1D670–U+1D689, a-z: U+1D68A–U+1D6A3)
    [/[\u{1D670}-\u{1D689}]/gu, (m) => String.fromCharCode(m.codePointAt(0)! - 0x1D670 + 65)],
    [/[\u{1D68A}-\u{1D6A3}]/gu, (m) => String.fromCharCode(m.codePointAt(0)! - 0x1D68A + 97)],
    // Mathematical Bold digits (0-9: U+1D7CE–U+1D7D7)
    [/[\u{1D7CE}-\u{1D7D7}]/gu, (m) => String.fromCharCode(m.codePointAt(0)! - 0x1D7CE + 48)],
    // Fullwidth Latin (A-Z: U+FF21–U+FF3A, a-z: U+FF41–U+FF5A)
    [/[\uFF21-\uFF3A]/gu, (m) => String.fromCharCode(m.charCodeAt(0) - 0xFF21 + 65)],
    [/[\uFF41-\uFF5A]/gu, (m) => String.fromCharCode(m.charCodeAt(0) - 0xFF41 + 97)],
    // Fullwidth digits (0-9: U+FF10–U+FF19)
    [/[\uFF10-\uFF19]/gu, (m) => String.fromCharCode(m.charCodeAt(0) - 0xFF10 + 48)],
    // Fullwidth symbols (@ . etc.)
    [/\uFF20/gu, () => '@'],
    [/\uFF0E/gu, () => '.'],
  ];

  let result = str;
  for (const [pattern, replacer] of replacements) {
    result = result.replace(pattern, replacer);
  }
  return result;
};

const transformMailIds = ({ value }: { value: string[] | string }) => {
  if (Array.isArray(value)) {
    return value.map((v) => normalizeFancyUnicode(String(v)).trim()).filter(Boolean);
  }

  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed)
        ? parsed.map((v) => normalizeFancyUnicode(String(v)).trim()).filter(Boolean)
        : [normalizeFancyUnicode(trimmed)];
    } catch {
      return [normalizeFancyUnicode(trimmed)];
    }
  }

  return trimmed.split(',').map((mailId) => normalizeFancyUnicode(mailId.trim())).filter(Boolean);
};

export class SendBulkMailDto {
  @ApiProperty({ example: 'Application for Software Developer Role' })
  @IsString()
  @IsNotEmpty()
  subject: string;

  @ApiProperty({ example: 'Hello, please find my resume attached for your consideration.' })
  @IsString()
  @IsNotEmpty()
  context: string;

  @ApiProperty({
    description: 'Multiple recipient email ids. In multipart/form-data, send as comma-separated text or a JSON array string.',
    example: 'hr@example.com,recruiter@example.com',
    type: [String],
  })
  @Transform(transformMailIds)
  @IsArray()
  @ArrayMinSize(1)
  @IsEmail({}, { each: true })
  mailIds: string[];

  @ApiPropertyOptional({ example: '665df8d2f98f48bd8f04f2a1' })
  @IsOptional()
  @IsMongoId()
  userId?: string;

  @ApiPropertyOptional({ description: 'Optional from address to use for this send' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'TTL for the provided from address in seconds (stored in DB)', example: 604800 })
  @IsOptional()
  @IsString()
  fromTtlSeconds?: string;
}
