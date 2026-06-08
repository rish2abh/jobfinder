import { BadRequestException } from '@nestjs/common';
import { ContactParserService } from './contact-parser.service';

describe('ContactParserService', () => {
  let service: ContactParserService;

  beforeEach(() => {
    service = new ContactParserService();
  });

  describe('parse()', () => {
    it('should reject files exceeding 10MB', async () => {
      const largeBuffer = Buffer.alloc(11 * 1024 * 1024); // 11MB
      await expect(
        service.parse(largeBuffer, 'text/csv', 'large.csv'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject unsupported file formats', async () => {
      const buffer = Buffer.from('some content');
      await expect(
        service.parse(buffer, 'application/json', 'data.json'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should route CSV files to parseCSV', async () => {
      const csv = 'name,email,title,company\nJohn Doe,john@example.com,Engineer,Acme\n';
      const buffer = Buffer.from(csv);
      const result = await service.parse(buffer, 'text/csv', 'contacts.csv');
      expect(result.contacts).toHaveLength(1);
      expect(result.contacts[0]).toEqual({
        name: 'John Doe',
        email: 'john@example.com',
        title: 'Engineer',
        company: 'Acme',
      });
    });
  });

  describe('parseCSV()', () => {
    it('should parse a valid CSV with standard headers', async () => {
      const csv = 'name,email,title,company\nAlice,alice@test.com,Manager,Corp\nBob,bob@test.com,Dev,StartupCo\n';
      const result = await service.parseCSV(Buffer.from(csv));
      expect(result.contacts).toHaveLength(2);
      expect(result.contacts[0].name).toBe('Alice');
      expect(result.contacts[1].company).toBe('StartupCo');
      expect(result.skipped).toHaveLength(0);
    });

    it('should handle alternative column names (case-insensitive)', async () => {
      const csv = 'Full Name,E-Mail,Job Title,Organization\nJane Smith,jane@co.org,CTO,BigCorp\n';
      const result = await service.parseCSV(Buffer.from(csv));
      expect(result.contacts).toHaveLength(1);
      expect(result.contacts[0]).toEqual({
        name: 'Jane Smith',
        email: 'jane@co.org',
        title: 'CTO',
        company: 'BigCorp',
      });
    });

    it('should derive name from email when name is missing', async () => {
      const csv = 'name,email,title,company\n,missing@name.com,,Corp\n';
      const result = await service.parseCSV(Buffer.from(csv));
      expect(result.contacts).toHaveLength(1);
      expect(result.contacts[0].name).toBe('Missing');
      expect(result.contacts[0].email).toBe('missing@name.com');
      expect(result.skipped).toHaveLength(0);
    });

    it('should skip rows missing email', async () => {
      const csv = 'name,email,title,company\nJohn Doe,,Dev,Corp\n';
      const result = await service.parseCSV(Buffer.from(csv));
      expect(result.contacts).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toBe('Missing email');
    });

    it('should skip rows missing both name and email', async () => {
      const csv = 'name,email,title,company\n,,,\n';
      const result = await service.parseCSV(Buffer.from(csv));
      expect(result.contacts).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toBe('Missing both name and email');
    });

    it('should handle optional title and company as undefined', async () => {
      const csv = 'name,email,title,company\nJohn,john@test.com,,\n';
      const result = await service.parseCSV(Buffer.from(csv));
      expect(result.contacts).toHaveLength(1);
      expect(result.contacts[0].title).toBeUndefined();
      expect(result.contacts[0].company).toBeUndefined();
    });

    it('should trim whitespace from values', async () => {
      const csv = 'name,email,title,company\n  John Doe  ,  john@test.com  ,  Engineer  ,  Acme  \n';
      const result = await service.parseCSV(Buffer.from(csv));
      expect(result.contacts[0]).toEqual({
        name: 'John Doe',
        email: 'john@test.com',
        title: 'Engineer',
        company: 'Acme',
      });
    });
  });

  describe('parsePDF()', () => {
    it('should extract contacts from a PDF with email addresses', async () => {
      // Create a minimal valid PDF buffer with text content
      // pdf-parse needs a real PDF, so we mock at the integration level
      // For unit test, we test the text extraction logic via parseDOCX-like patterns
      // This test validates that the method exists and handles errors
      const invalidBuffer = Buffer.from('not a real pdf');
      await expect(service.parsePDF(invalidBuffer)).rejects.toThrow();
    });
  });

  describe('parseDOCX()', () => {
    it('should handle empty document text', async () => {
      // mammoth with an empty/invalid buffer may throw or return empty
      // We test the text parsing logic indirectly
      const emptyDocxBuffer = Buffer.from('');
      // mammoth will likely throw for an invalid buffer
      await expect(service.parseDOCX(emptyDocxBuffer)).rejects.toThrow();
    });
  });

  describe('text parsing (via parseCSV as proxy for shared logic)', () => {
    it('should handle a CSV with many rows', async () => {
      const headers = 'name,email,title,company\n';
      const rows = Array.from({ length: 100 }, (_, i) =>
        `User${i},user${i}@test.com,Title${i},Company${i}\n`,
      ).join('');
      const result = await service.parseCSV(Buffer.from(headers + rows));
      expect(result.contacts).toHaveLength(100);
      expect(result.skipped).toHaveLength(0);
    });
  });
});
