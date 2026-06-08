import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import axios from 'axios';
import { EmailTemplate, EmailTemplateDocument } from './email-template.schema';

@Injectable()
export class TemplateGeneratorService {
  private readonly logger = new Logger(TemplateGeneratorService.name);
  private readonly ollamaUrl: string;
  private readonly model: string;

  constructor(
    @InjectModel(EmailTemplate.name)
    private emailTemplateModel: Model<EmailTemplateDocument>,
  ) {
    this.ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
    this.model = process.env.OLLAMA_MODEL || 'mistral';
  }

  /**
   * Generate an email template for a contact group using Ollama.
   * Returns cached template if already generated for the group.
   * Falls back to allowing manual input if Ollama fails.
   */
  async generateTemplate(
    groupId: Types.ObjectId,
    userId: Types.ObjectId,
    groupType: 'title' | 'company',
    groupValue: string,
    userProfile: Record<string, unknown>,
    userPrompt?: string,
  ): Promise<EmailTemplateDocument> {
    // Check cache first
    const cached = await this.emailTemplateModel.findOne({ groupId });
    if (cached) {
      this.logger.log(`Returning cached template for group ${groupId}`);
      return cached;
    }

    // Attempt AI generation
    try {
      const { subject, body } = await this.callOllama(
        groupType,
        groupValue,
        userProfile,
        userPrompt,
      );

      const template = await this.emailTemplateModel.findOneAndUpdate(
        { groupId },
        {
          groupId,
          userId,
          subject: subject.slice(0, 200),
          body: body.slice(0, 2000),
          generatedBy: 'ai',
          cachedAt: new Date(),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      this.logger.log(`AI template generated for group ${groupId}`);
      return template;
    } catch (error) {
      this.logger.warn(
        `Ollama template generation failed for group ${groupId}: ${error.message}. Falling back to manual input.`,
      );

      // Return a placeholder that signals manual input is needed
      const fallback = await this.emailTemplateModel.findOneAndUpdate(
        { groupId },
        {
          groupId,
          userId,
          subject: '',
          body: '',
          generatedBy: 'manual',
          cachedAt: new Date(),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      return fallback;
    }
  }

  /**
   * Save a manually provided template for a group.
   */
  async saveManualTemplate(
    groupId: Types.ObjectId,
    userId: Types.ObjectId,
    subject: string,
    body: string,
  ): Promise<EmailTemplateDocument> {
    const template = await this.emailTemplateModel.findOneAndUpdate(
      { groupId },
      {
        groupId,
        userId,
        subject: subject.slice(0, 200),
        body: body.slice(0, 2000),
        generatedBy: 'manual',
        cachedAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    this.logger.log(`Manual template saved for group ${groupId}`);
    return template;
  }

  /**
   * Call Ollama to generate an email subject + body.
   */
  private async callOllama(
    groupType: 'title' | 'company',
    groupValue: string,
    userProfile: Record<string, unknown>,
    userPrompt?: string,
  ): Promise<{ subject: string; body: string }> {
    const profileSummary = this.buildProfileSummary(userProfile);
    const prompt = this.buildPrompt(groupType, groupValue, profileSummary, userPrompt);

    this.logger.log(`Calling Ollama for template generation — group: ${groupValue}`);

    const startTime = Date.now();
    let response: any;
    try {
      response = await axios.post(
        `${this.ollamaUrl}/api/generate`,
        {
          model: this.model,
          prompt,
          stream: false,
          options: {
            temperature: 0.7,
            num_predict: 1200,
          },
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 60_000, // 60 seconds
        },
      );

      const elapsed = Date.now() - startTime;
      this.logger.log(
        `[Ollama] template-generation — success — elapsed: ${elapsed}ms, status: ${response.status}`,
      );
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      const status = err?.response?.status;
      this.logger.error(
        `[Ollama] template-generation — failed — elapsed: ${elapsed}ms` +
        `${status ? `, status: ${status}` : ''}, error: ${err.message}`,
        err.stack,
      );
      throw err;
    }

    const responseText = this.extractResponseText(response.data);
    if (!responseText) {
      throw new Error('Ollama returned empty response');
    }

    return this.parseTemplateResponse(responseText);
  }

  /**
   * Build a concise profile summary for the AI prompt.
   */
  private buildProfileSummary(userProfile: Record<string, unknown>): string {
    const parts: string[] = [];

    if (userProfile.name) parts.push(`Name: ${userProfile.name}`);
    if (userProfile.headline) parts.push(`Headline: ${userProfile.headline}`);
    if (userProfile.bio) parts.push(`Bio: ${userProfile.bio}`);
    if (Array.isArray(userProfile.skills) && userProfile.skills.length > 0) {
      parts.push(`Skills: ${userProfile.skills.slice(0, 10).join(', ')}`);
    }
    if (userProfile.location) parts.push(`Location: ${userProfile.location}`);

    return parts.join('\n') || 'No profile information available';
  }

  /**
   * Build the prompt for email template generation.
   */
  private buildPrompt(
    groupType: 'title' | 'company',
    groupValue: string,
    profileSummary: string,
    userPrompt?: string,
  ): string {
    const context = groupType === 'company'
      ? `recruiters/contacts at the company "${groupValue}"`
      : `professionals with the job title "${groupValue}"`;

    const userContext = userPrompt
      ? `\nAdditional context from the user: ${userPrompt}`
      : '';

    return `You are an email copywriter. Generate a professional cold outreach email to ${context}.

The sender's profile:
${profileSummary}
${userContext}

RULES:
- Output ONLY a valid JSON object with "subject" and "body" keys
- Subject must be under 200 characters — concise and compelling
- Body must be under 2000 characters — professional, personalized, and actionable
- Use {{name}} as a placeholder for the recipient's name
- Use {{company}} as a placeholder for the recipient's company
- Use {{title}} as a placeholder for the recipient's title
- Keep the tone professional but warm
- Include a clear call-to-action
- NO markdown, NO code fences, just raw JSON

Output format:
{"subject": "your subject line here", "body": "your email body here"}

JSON:`;
  }

  /**
   * Extract text from Ollama native /api/generate response.
   */
  private extractResponseText(data: unknown): string {
    if (!data) return '';
    if (typeof data === 'string') return data;

    const d = data as Record<string, unknown>;

    if (typeof d.response === 'string' && d.response.length > 0) {
      return d.response;
    }

    const choices = d.choices as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(choices) && choices.length > 0) {
      const first = choices[0];
      if (typeof first.text === 'string') return first.text;
      const msg = first.message as Record<string, unknown> | undefined;
      if (typeof msg?.content === 'string') return msg.content;
    }

    return '';
  }

  /**
   * Parse the AI response to extract subject and body.
   */
  private parseTemplateResponse(responseText: string): { subject: string; body: string } {
    let text = responseText
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/gi, '')
      .trim();

    // Try to find JSON object
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const candidate = text.slice(firstBrace, lastBrace + 1);
      try {
        const parsed = JSON.parse(candidate);
        if (parsed.subject && parsed.body) {
          return {
            subject: String(parsed.subject).slice(0, 200),
            body: String(parsed.body).slice(0, 2000),
          };
        }
      } catch {
        // Try repair: remove trailing commas
        const repaired = candidate
          .replace(/,\s*}/g, '}')
          .replace(/,\s*]/g, ']');
        try {
          const parsed = JSON.parse(repaired);
          if (parsed.subject && parsed.body) {
            return {
              subject: String(parsed.subject).slice(0, 200),
              body: String(parsed.body).slice(0, 2000),
            };
          }
        } catch { /* fall through */ }
      }
    }

    // Fallback: try to extract subject and body from plain text
    const subjectMatch = text.match(/subject[:\s]*["']?([^"'\n]+)/i);
    const bodyMatch = text.match(/body[:\s]*["']?(.+)/is);

    if (subjectMatch && bodyMatch) {
      return {
        subject: subjectMatch[1].trim().slice(0, 200),
        body: bodyMatch[1].trim().slice(0, 2000),
      };
    }

    throw new Error('Could not parse subject and body from Ollama response');
  }
}
