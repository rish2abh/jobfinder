import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import axios from 'axios';
import Groq from 'groq-sdk';
import { EmailTemplate, EmailTemplateDocument } from './email-template.schema';

@Injectable()
export class TemplateGeneratorService {
  private readonly logger = new Logger(TemplateGeneratorService.name);
  private readonly ollamaUrl: string;
  private readonly ollamaModel: string;
  private readonly groqClient: Groq | null;
  private readonly groqModel: string;

  constructor(
    @InjectModel(EmailTemplate.name)
    private emailTemplateModel: Model<EmailTemplateDocument>,
  ) {
    this.ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
    this.ollamaModel = process.env.OLLAMA_MODEL || 'mistral';
    this.groqModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

    const groqApiKey = process.env.GROQ_API_KEY;
    this.groqClient = groqApiKey
      ? new Groq({ apiKey: groqApiKey })
      : null;
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

    // Attempt AI generation — Groq first, Ollama fallback
    try {
      let result: { subject: string; body: string };
      let aiProvider: 'groq' | 'ollama';

      if (this.groqClient) {
        try {
          result = await this.callGroq(groupType, groupValue, userProfile, userPrompt);
          aiProvider = 'groq';
        } catch (groqError) {
          this.logger.warn(
            `Groq template generation failed for group ${groupId}: ${groqError.message}. Falling back to Ollama.`,
          );
          result = await this.callOllama(groupType, groupValue, userProfile, userPrompt);
          aiProvider = 'ollama';
        }
      } else {
        result = await this.callOllama(groupType, groupValue, userProfile, userPrompt);
        aiProvider = 'ollama';
      }

      const template = await this.emailTemplateModel.findOneAndUpdate(
        { groupId },
        {
          groupId,
          userId,
          subject: result.subject.slice(0, 200),
          body: result.body.slice(0, 2000),
          generatedBy: 'ai',
          aiProvider,
          cachedAt: new Date(),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      this.logger.log(`AI template generated for group ${groupId}`);
      return template;
    } catch (error) {
      this.logger.warn(
        `All AI template generation failed for group ${groupId}: ${error.message}. Falling back to manual input.`,
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
          aiProvider: null,
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
   * Call Groq to generate an email subject + body.
   */
  private async callGroq(
    groupType: 'title' | 'company',
    groupValue: string,
    userProfile: Record<string, unknown>,
    userPrompt?: string,
  ): Promise<{ subject: string; body: string }> {
    const profileSummary = this.buildProfileSummary(userProfile);
    const prompt = this.buildPrompt(groupType, groupValue, profileSummary, userPrompt);

    this.logger.log(`Calling Groq for template generation — group: ${groupValue}`);

    const startTime = Date.now();
    try {
      const chatCompletion = await this.groqClient.chat.completions.create({
        model: this.groqModel,
        messages: [
          {
            role: 'system',
            content: 'You are an expert cold email writer specializing in job outreach emails. You output only valid JSON with "subject" and "body" keys. No markdown, no code fences. Write concise, high-converting cold emails under 150 words.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 1200,
      });

      const elapsed = Date.now() - startTime;
      this.logger.log(
        `[Groq] template-generation — success — elapsed: ${elapsed}ms, model: ${this.groqModel}`,
      );

      const responseText = chatCompletion.choices?.[0]?.message?.content || '';
      if (!responseText) {
        throw new Error('Groq returned empty response');
      }

      return this.parseTemplateResponse(responseText);
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      this.logger.error(
        `[Groq] template-generation — failed — elapsed: ${elapsed}ms, error: ${err.message}`,
        err.stack,
      );
      throw err;
    }
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
          model: this.ollamaModel,
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
   * Build a detailed profile summary for the AI prompt including all user info.
   */
  private buildProfileSummary(userProfile: Record<string, unknown>): string {
    const parts: string[] = [];

    if (userProfile.name) parts.push(`Name: ${userProfile.name}`);
    if (userProfile.headline) parts.push(`Current Role/Title: ${userProfile.headline}`);
    if (userProfile.bio) parts.push(`Bio: ${userProfile.bio}`);
    if (userProfile.location) parts.push(`Location: ${userProfile.location}`);

    // Skills
    if (Array.isArray(userProfile.skills) && userProfile.skills.length > 0) {
      parts.push(`Key Skills: ${userProfile.skills.slice(0, 15).join(', ')}`);
    }

    // Experience / Years
    const experience = userProfile.experience as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(experience) && experience.length > 0) {
      const yearsOfExp = this.estimateYearsOfExperience(experience);
      parts.push(`Years of Experience: ~${yearsOfExp}`);
      const notableRoles = experience
        .slice(0, 3)
        .map((e) => `${e.title || 'Role'} at ${e.company || 'Company'}`)
        .join('; ');
      parts.push(`Notable Roles: ${notableRoles}`);
    }

    // Projects
    const projects = userProfile.projects as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(projects) && projects.length > 0) {
      const notableProjects = projects
        .slice(0, 3)
        .map((p) => {
          const techs = Array.isArray(p.technologies) ? ` (${(p.technologies as string[]).join(', ')})` : '';
          return `${p.name || 'Project'}${techs}`;
        })
        .join('; ');
      parts.push(`Notable Projects: ${notableProjects}`);
    }

    // Education
    const education = userProfile.education as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(education) && education.length > 0) {
      const edu = education[0];
      parts.push(`Education: ${edu.degree || ''} ${edu.field ? `in ${edu.field}` : ''} from ${edu.institution || 'Unknown'}`);
    }

    // Online presence
    if (userProfile.github) parts.push(`GitHub: ${userProfile.github}`);
    if (userProfile.linkedin) parts.push(`LinkedIn: ${userProfile.linkedin}`);
    if (userProfile.website) parts.push(`Portfolio: ${userProfile.website}`);

    return parts.join('\n') || 'No profile information available';
  }

  /**
   * Estimate years of experience from experience entries.
   */
  private estimateYearsOfExperience(experience: Array<Record<string, unknown>>): number {
    let totalYears = 0;
    for (const exp of experience) {
      const start = exp.startDate as string | undefined;
      const end = exp.endDate as string | undefined;
      if (start) {
        const startYear = parseInt(start.slice(0, 4), 10);
        const endYear = end && end.toLowerCase() !== 'present'
          ? parseInt(end.slice(0, 4), 10)
          : new Date().getFullYear();
        if (!isNaN(startYear) && !isNaN(endYear)) {
          totalYears += Math.max(0, endYear - startYear);
        }
      }
    }
    return totalYears || experience.length; // fallback: 1 year per role
  }

  /**
   * Build the prompt for email template generation using detailed cold email strategy.
   */
  private buildPrompt(
    groupType: 'title' | 'company',
    groupValue: string,
    profileSummary: string,
    userPrompt?: string,
  ): string {
    const recipientRole = groupType === 'company'
      ? 'HR/Recruiter'
      : groupValue;

    const companyContext = groupType === 'company'
      ? groupValue
      : '{{company}}';

    const userContext = userPrompt
      ? `\nAdditional context from the user: ${userPrompt}`
      : '';

    return `You are an expert cold email writer specializing in job outreach emails.
Generate a personalized cold email based on the following information:

RECIPIENT INFO:
- Name: {{name}}
- Role: ${recipientRole}
- Company: ${companyContext}

SENDER INFO:
${profileSummary}
${userContext}

JOB CONTEXT:
- Position Interested In: ${groupType === 'title' ? groupValue : 'relevant open positions'}
- Why this company: Genuine interest based on company's work and culture

RULES:
1. Subject line must be curiosity-driven, personalized, and under 8 words — make it impossible to ignore
2. Tone changes based on recipient role:
   - HR → professional, warm, achievement focused
   - CEO/Founder → bold, value driven, straight to the point
   - Consultant → peer to peer, collaborative tone
   - CTO/Tech Lead → technical, project focused, skill heavy
3. First line must NOT start with "I" — hook them immediately
4. Mention ONE specific thing about their company that shows you did research (use {{company}} placeholder)
5. Clearly state what value you bring if you join — not just what you want
6. Keep email under 150 words — short emails get read
7. End with a low friction CTA — not "please give me a job" but "would love a 15 min chat"
8. Add GitHub, LinkedIn and Portfolio as clean clickable links at the bottom (only if available in sender info)
9. No generic lines like "I am writing to express my interest"
10. Use {{name}} for recipient name and {{company}} for company name placeholders

OUTPUT FORMAT:
You MUST respond with ONLY a valid JSON object — no markdown, no code fences, no explanation.
{"subject": "<subject line>", "body": "<email body including links section at bottom>"}

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
