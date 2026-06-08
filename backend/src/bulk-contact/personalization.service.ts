import { Injectable } from '@nestjs/common';

export interface TemplateInput {
  subject: string;
  body: string;
}

export interface RecipientInput {
  name: string;
  company?: string;
  title?: string;
}

export interface PersonalizedOutput {
  subject: string;
  body: string;
}

@Injectable()
export class PersonalizationService {
  /**
   * Replace {{name}}, {{company}}, {{title}} placeholders (case-insensitive)
   * with actual recipient values. If a value is empty/undefined, replace with empty string.
   */
  personalizeTemplate(
    template: TemplateInput,
    recipient: RecipientInput,
  ): PersonalizedOutput {
    return {
      subject: this.replacePlaceholders(template.subject, recipient),
      body: this.replacePlaceholders(template.body, recipient),
    };
  }

  /**
   * Replace all placeholder tokens in the text with recipient values.
   * Placeholders are case-insensitive: {{Name}}, {{NAME}}, {{name}} all match.
   */
  private replacePlaceholders(text: string, recipient: RecipientInput): string {
    return text
      .replace(/\{\{name\}\}/gi, recipient.name || '')
      .replace(/\{\{company\}\}/gi, recipient.company || '')
      .replace(/\{\{title\}\}/gi, recipient.title || '');
  }
}
