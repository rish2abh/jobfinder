import { Test, TestingModule } from '@nestjs/testing';
import { PersonalizationService } from './personalization.service';

describe('PersonalizationService', () => {
  let service: PersonalizationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PersonalizationService],
    }).compile();

    service = module.get<PersonalizationService>(PersonalizationService);
  });

  describe('personalizeTemplate', () => {
    it('should replace all placeholders with recipient values', () => {
      const template = {
        subject: 'Hi {{name}}, opportunity at {{company}}',
        body: 'Dear {{name}}, I noticed your role as {{title}} at {{company}}.',
      };
      const recipient = {
        name: 'Rishabh',
        company: 'Google',
        title: 'Engineering Manager',
      };

      const result = service.personalizeTemplate(template, recipient);

      expect(result.subject).toBe('Hi Rishabh, opportunity at Google');
      expect(result.body).toBe(
        'Dear Rishabh, I noticed your role as Engineering Manager at Google.',
      );
    });

    it('should handle case-insensitive placeholders', () => {
      const template = {
        subject: '{{NAME}} at {{Company}}',
        body: 'Hello {{Name}}, your {{TITLE}} role at {{COMPANY}} is impressive.',
      };
      const recipient = {
        name: 'Alice',
        company: 'Meta',
        title: 'Senior Developer',
      };

      const result = service.personalizeTemplate(template, recipient);

      expect(result.subject).toBe('Alice at Meta');
      expect(result.body).toBe(
        'Hello Alice, your Senior Developer role at Meta is impressive.',
      );
    });

    it('should replace missing/undefined values with empty string', () => {
      const template = {
        subject: 'Hi {{name}} at {{company}}',
        body: 'Your title is {{title}} at {{company}}.',
      };
      const recipient = {
        name: 'Bob',
        company: undefined,
        title: undefined,
      };

      const result = service.personalizeTemplate(template, recipient);

      expect(result.subject).toBe('Hi Bob at ');
      expect(result.body).toBe('Your title is  at .');
    });

    it('should replace empty string values with empty string', () => {
      const template = {
        subject: '{{name}} - {{title}}',
        body: 'At {{company}}',
      };
      const recipient = {
        name: 'Charlie',
        company: '',
        title: '',
      };

      const result = service.personalizeTemplate(template, recipient);

      expect(result.subject).toBe('Charlie - ');
      expect(result.body).toBe('At ');
    });

    it('should handle templates with no placeholders', () => {
      const template = {
        subject: 'Job Opportunity',
        body: 'I would like to connect.',
      };
      const recipient = {
        name: 'Dave',
        company: 'Amazon',
        title: 'SDE',
      };

      const result = service.personalizeTemplate(template, recipient);

      expect(result.subject).toBe('Job Opportunity');
      expect(result.body).toBe('I would like to connect.');
    });

    it('should handle multiple occurrences of the same placeholder', () => {
      const template = {
        subject: '{{name}} - {{name}}',
        body: '{{company}} is great. I love {{company}}.',
      };
      const recipient = {
        name: 'Eve',
        company: 'Netflix',
        title: 'PM',
      };

      const result = service.personalizeTemplate(template, recipient);

      expect(result.subject).toBe('Eve - Eve');
      expect(result.body).toBe('Netflix is great. I love Netflix.');
    });

    it('should not replace partial or malformed placeholders', () => {
      const template = {
        subject: '{name} and {{name}}',
        body: '{{unknown}} stays, but {{title}} replaced.',
      };
      const recipient = {
        name: 'Frank',
        company: 'Apple',
        title: 'Designer',
      };

      const result = service.personalizeTemplate(template, recipient);

      expect(result.subject).toBe('{name} and Frank');
      expect(result.body).toBe('{{unknown}} stays, but Designer replaced.');
    });
  });
});
