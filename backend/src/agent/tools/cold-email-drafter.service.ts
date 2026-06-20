import { Injectable, Logger } from '@nestjs/common';
import { AgentTool } from './tool-registry';
import { GeminiFunctionDeclaration, GeminiClientService } from '../gemini-client.service';
import { DraftRepository } from '../drafts/draft.repository';
import { BulkContactService } from '../../bulk-contact/bulk-contact.service';
import { UsersService } from '../../users/users.service';
import { JobsRepository } from '../../jobs/jobs.repository';
import { validateTemplateOutput } from '../shared';

/**
 * Drafts personalized cold emails per-contact using Gemini AI.
 * Fetches the contact, optional job, and user profile, then builds a per-person
 * prompt (structured like TemplateGeneratorService.buildPrompt) and parses the
 * response using the same fence-stripping + JSON-repair logic.
 *
 * Emails are never sent directly — always saved as drafts for user approval.
 */
@Injectable()
export class ColdEmailDrafterService implements AgentTool {
  private readonly logger = new Logger(ColdEmailDrafterService.name);
  readonly name = 'draft_cold_email';

  readonly declaration: GeminiFunctionDeclaration = {
    name: 'draft_cold_email',
    description:
      'Draft a personalized cold outreach email to a specific contact. ' +
      'Fetches the contact, optional job listing, and user profile to generate ' +
      'a tailored email via AI. Emails are saved as drafts requiring user approval.',
    parameters: {
      type: 'object',
      properties: {
        contactId: {
          type: 'string',
          description: 'MongoDB ID of the BulkContact to draft an email for (required)',
        },
        jobId: {
          type: 'string',
          description: 'MongoDB ID of a job listing to reference in the email (optional)',
        },
        customContext: {
          type: 'string',
          description: 'Additional context for personalization (e.g. "mention my React projects")',
        },
      },
      required: ['contactId'],
    },
  };

  constructor(
    private readonly draftRepo: DraftRepository,
    private readonly bulkContactService: BulkContactService,
    private readonly usersService: UsersService,
    private readonly jobsRepository: JobsRepository,
    private readonly geminiClient: GeminiClientService,
  ) {}

  async execute(args: Record<string, unknown>): Promise<unknown> {
    const userId = args.userId as string;
    const contactId = args.contactId as string;
    const jobId = args.jobId as string | undefined;
    const customContext = args.customContext as string | undefined;
    const runId = (args.runId as string) || 'agent';

    if (!contactId) {
      return { error: 'contactId is required' };
    }

    return this.draftColdEmail(userId, contactId, jobId, customContext, runId);
  }

  /**
   * Core method: fetch contact, optional job, and profile → build prompt →
   * call Gemini → parse + validate → deduplicate → save draft.
   */
  async draftColdEmail(
    userId: string,
    contactId: string,
    jobId?: string,
    customContext?: string,
    runId = 'agent',
  ) {
    // 1. Fetch the contact
    const contact = await this.bulkContactService.getContactById(userId, contactId);

    // 2. Fetch the job listing if jobId provided
    let job: { title?: string; company?: string; location?: string; jd?: string } | null = null;
    if (jobId) {
      const jobDoc = await this.jobsRepository.findById(jobId);
      if (jobDoc) {
        job = {
          title: jobDoc.title,
          company: jobDoc.company,
          location: jobDoc.location,
          jd: jobDoc.jd,
        };
      }
    }

    // 3. Fetch user profile
    const user = await this.usersService.findById(userId);
    const profile = user?.profile || {};
    const userProfile: Record<string, unknown> = {
      name: user?.name,
      headline: profile.headline,
      bio: profile.bio,
      skills: profile.skills || [],
      location: profile.location,
      experience: profile.experience || [],
      education: profile.education || [],
      projects: profile.projects || [],
      github: profile.github,
      linkedin: profile.linkedin,
      website: profile.website,
    };

    // 4. Check for existing pending/edited draft to this recipient (dedup)
    const recipientIdentifier = contact.email.toLowerCase();
    const existingDrafts = await this.draftRepo.findPending(userId);
    const duplicate = existingDrafts.find(
      (d) =>
        d.recipient === recipientIdentifier &&
        (d.status === 'pending' || d.status === 'edited'),
    );
    if (duplicate) {
      return {
        status: 'skipped',
        reason: 'A pending or edited draft already exists for this recipient.',
        existingDraftId: duplicate._id.toString(),
        recipient: contact.name,
      };
    }

    // 5. Build prompt (structured like TemplateGeneratorService.buildPrompt)
    const prompt = this.buildPersonalPrompt(contact, job, userProfile, customContext);

    // 6. Call Gemini
    const systemInstruction =
      'You are an expert cold email writer specializing in job outreach emails. ' +
      'You output only valid JSON with "subject" and "body" keys. No markdown, no code fences. ' +
      'Write concise, high-converting cold emails under 150 words.';

    const response = await this.geminiClient.generateContent(
      [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction,
    );

    if (!response.text) {
      return { error: 'Gemini returned an empty response' };
    }

    // 7. Parse response (same fence-stripping + JSON-repair as TemplateGeneratorService)
    let parsed: { subject: string; body: string };
    try {
      parsed = this.parseTemplateResponse(response.text);
    } catch (parseErr) {
      this.logger.warn(`Failed to parse Gemini response for contact ${contactId}: ${parseErr.message}`);
      return { error: `Failed to parse AI response: ${parseErr.message}` };
    }

    // 8. Validate with validateTemplateOutput
    const validation = validateTemplateOutput(parsed);
    if (!validation.valid) {
      this.logger.warn(`Template validation failed: ${validation.errors.join(', ')}`);
      return {
        error: 'Generated email failed validation',
        validationErrors: validation.errors,
      };
    }

    // 9. Save draft
    const draft = await this.draftRepo.create({
      userId,
      type: 'cold_outreach',
      status: 'pending',
      recipient: recipientIdentifier,
      subject: parsed.subject,
      body: parsed.body,
      createdByRunId: runId,
    });

    this.logger.log(
      `Cold email draft created for contact ${contact.name} (${contact.email}) — draftId: ${draft._id}`,
    );

    return {
      status: 'draft_created',
      draftId: draft._id.toString(),
      recipient: contact.name,
      recipientEmail: contact.email,
      company: contact.company || job?.company || 'Unknown',
      subject: parsed.subject,
      message: 'Cold email draft created. Review it in /agent/drafts and approve to send.',
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Build a per-person prompt structured like TemplateGeneratorService.buildPrompt()
   * but addressed to one specific person, referencing the specific job if available.
   */
  private buildPersonalPrompt(
    contact: { name: string; email: string; title?: string; company?: string },
    job: { title?: string; company?: string; location?: string; jd?: string } | null,
    userProfile: Record<string, unknown>,
    customContext?: string,
  ): string {
    const profileSummary = this.buildProfileSummary(userProfile);

    const recipientRole = contact.title || 'Hiring Manager';
    const company = contact.company || job?.company || 'their company';

    const jobContext = job
      ? `- Position: ${job.title || 'Open role'}\n- Company: ${job.company || company}\n- Location: ${job.location || 'Not specified'}\n${job.jd ? `- Job Description (excerpt): ${job.jd.slice(0, 500)}` : ''}`
      : `- Position Interested In: relevant open positions at ${company}`;

    const userContextLine = customContext
      ? `\nAdditional context from the user: ${customContext}`
      : '';

    return `You are an expert cold email writer specializing in job outreach emails.
Generate a personalized cold email based on the following information:

RECIPIENT INFO:
- Name: ${contact.name}
- Email: ${contact.email}
- Role: ${recipientRole}
- Company: ${company}

SENDER INFO:
${profileSummary}
${userContextLine}

JOB CONTEXT:
${jobContext}

RULES:
1. Subject line must be curiosity-driven, personalized, and under 8 words — make it impossible to ignore
2. Tone changes based on recipient role:
   - HR → professional, warm, achievement focused
   - CEO/Founder → bold, value driven, straight to the point
   - Consultant → peer to peer, collaborative tone
   - CTO/Tech Lead → technical, project focused, skill heavy
3. First line must NOT start with "I" — hook them immediately
4. Mention ONE specific thing about their company that shows you did research
5. Clearly state what value you bring if you join — not just what you want
6. Keep email under 150 words — short emails get read
7. End with a low friction CTA — not "please give me a job" but "would love a 15 min chat"
8. Add GitHub, LinkedIn and Portfolio as clean clickable links at the bottom (only if available in sender info)
9. No generic lines like "I am writing to express my interest"
10. Address the recipient by their actual name: ${contact.name}

OUTPUT FORMAT:
You MUST respond with ONLY a valid JSON object — no markdown, no code fences, no explanation.
{"subject": "<subject line>", "body": "<email body including links section at bottom>"}

JSON:`;
  }

  /**
   * Build a detailed profile summary (same logic as TemplateGeneratorService).
   */
  private buildProfileSummary(userProfile: Record<string, unknown>): string {
    const parts: string[] = [];

    if (userProfile.name) parts.push(`Name: ${userProfile.name}`);
    if (userProfile.headline) parts.push(`Current Role/Title: ${userProfile.headline}`);
    if (userProfile.bio) parts.push(`Bio: ${userProfile.bio}`);
    if (userProfile.location) parts.push(`Location: ${userProfile.location}`);

    if (Array.isArray(userProfile.skills) && userProfile.skills.length > 0) {
      parts.push(`Key Skills: ${userProfile.skills.slice(0, 15).join(', ')}`);
    }

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

    const education = userProfile.education as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(education) && education.length > 0) {
      const edu = education[0];
      parts.push(`Education: ${edu.degree || ''} ${edu.field ? `in ${edu.field}` : ''} from ${edu.institution || 'Unknown'}`);
    }

    if (userProfile.github) parts.push(`GitHub: ${userProfile.github}`);
    if (userProfile.linkedin) parts.push(`LinkedIn: ${userProfile.linkedin}`);
    if (userProfile.website) parts.push(`Portfolio: ${userProfile.website}`);

    return parts.join('\n') || 'No profile information available';
  }

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
    return totalYears || experience.length;
  }

  /**
   * Parse the AI response — reuses the same fence-stripping and JSON-repair
   * logic from TemplateGeneratorService.parseTemplateResponse().
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

    throw new Error('Could not parse subject and body from AI response');
  }
}
