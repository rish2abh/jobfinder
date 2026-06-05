import type { UserProfile, ExperienceItem, EducationItem } from './user.schema';

/**
 * Extracts a structured profile from raw resume text using regex heuristics.
 *
 * Used as a fallback when:
 *  - The Ollama parse produced a _parseError fallback object
 *  - The user has rawText but no structured resume yet
 *  - The user triggers manual re-extraction
 *
 * Not perfect — designed to get "good enough" data for job applications
 * that the user can then edit in the profile UI.
 */
export function extractProfileFromRawText(rawText: string): Partial<UserProfile> {
  const text = rawText || '';
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  const profile: Partial<UserProfile> = {};

  // ── Phone ────────────────────────────────────────────────────────────────
  const phoneMatch = text.match(
    /(\+?\d{1,3}[\s\-.]?)?\(?\d{3,5}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{3,4}/,
  );
  if (phoneMatch) profile.phone = phoneMatch[0].trim();

  // ── Email (for reference — not stored here, already on User) ─────────────
  // Skipped — email already stored on the User model.

  // ── Location / City ───────────────────────────────────────────────────────
  const locationPatterns = [
    /(?:location|address|city|based in|residing at)[:\s]+([^\n,]+(?:,\s*[^\n]+)?)/i,
    /([A-Z][a-z]+(?:\s[A-Z][a-z]+)?,\s*(?:India|USA|UK|Canada|Germany|Australia|Singapore|Remote))/,
  ];
  for (const pat of locationPatterns) {
    const m = text.match(pat);
    if (m) { profile.location = m[1].trim(); break; }
  }

  // ── LinkedIn ──────────────────────────────────────────────────────────────
  const linkedinMatch = text.match(/linkedin\.com\/in\/([^\s/\n]+)/i);
  if (linkedinMatch) profile.linkedin = `https://linkedin.com/in/${linkedinMatch[1]}`;

  // ── GitHub ────────────────────────────────────────────────────────────────
  const githubMatch = text.match(/github\.com\/([^\s/\n]+)/i);
  if (githubMatch) profile.github = `https://github.com/${githubMatch[1]}`;

  // ── Website / Portfolio ───────────────────────────────────────────────────
  const websiteMatch = text.match(/https?:\/\/(?!linkedin|github)[^\s\n]+\.[a-z]{2,}/i);
  if (websiteMatch) profile.website = websiteMatch[0];

  // ── Skills ────────────────────────────────────────────────────────────────
  const skillsSection = extractSection(text, [
    'skills', 'technical skills', 'core competencies',
    'technologies', 'tech stack', 'tools & technologies',
  ]);
  if (skillsSection) {
    profile.skills = skillsSection
      .split(/[,|•\n·\/]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 1 && s.length < 40 && !/^\d+$/.test(s))
      .slice(0, 30);
  }

  // ── Experience ────────────────────────────────────────────────────────────
  const expSection = extractSection(text, [
    'experience', 'work experience', 'professional experience',
    'employment history', 'work history',
  ]);
  if (expSection) {
    profile.experience = parseExperienceSection(expSection);
  }

  // ── Education ─────────────────────────────────────────────────────────────
  const eduSection = extractSection(text, [
    'education', 'academic background', 'qualifications',
    'academic qualifications', 'educational background',
  ]);
  if (eduSection) {
    profile.education = parseEducationSection(eduSection);
  }

  // ── Certifications ────────────────────────────────────────────────────────
  const certSection = extractSection(text, [
    'certifications', 'certificates', 'achievements',
    'awards', 'licenses',
  ]);
  if (certSection) {
    profile.certifications = certSection
      .split(/\n|•|·/)
      .map((s) => s.trim())
      .filter((s) => s.length > 3 && s.length < 120)
      .slice(0, 15);
  }

  // ── Languages ────────────────────────────────────────────────────────────
  const langSection = extractSection(text, ['languages', 'language skills']);
  if (langSection) {
    profile.languages = langSection
      .split(/[,|•\n·]/)
      .map((s) => s.replace(/\(.+?\)/g, '').trim())
      .filter((s) => s.length > 1 && s.length < 30)
      .slice(0, 10);
  }

  // ── Summary / Headline ────────────────────────────────────────────────────
  const summarySection = extractSection(text, [
    'summary', 'professional summary', 'objective',
    'profile', 'about', 'about me',
  ]);
  if (summarySection) {
    const cleaned = summarySection.replace(/\n+/g, ' ').trim();
    profile.bio = cleaned.slice(0, 800);
    // Use first sentence as headline
    const firstSentence = cleaned.match(/^.{10,120}?[.!]/)?.[0];
    if (firstSentence) profile.headline = firstSentence.trim();
  }

  profile.lastUpdatedFrom = 'raw_text_extract';
  profile.updatedAt = new Date();

  return profile;
}

/**
 * Merges a parsed JSON resume object into the profile shape.
 * The JSON from Ollama uses slightly different field names so we normalise.
 */
export function extractProfileFromParsedJson(
  parsedJson: Record<string, any>,
): Partial<UserProfile> {
  if (!parsedJson || '_parseError' in parsedJson) return {};

  const profile: Partial<UserProfile> = {};

  if (parsedJson.phone)    profile.phone    = String(parsedJson.phone);
  if (parsedJson.location) profile.location = String(parsedJson.location);
  if (parsedJson.summary)  profile.bio      = String(parsedJson.summary);
  if (parsedJson.linkedin) profile.linkedin = String(parsedJson.linkedin);
  if (parsedJson.github)   profile.github   = String(parsedJson.github);
  if (parsedJson.website)  profile.website  = String(parsedJson.website);

  if (Array.isArray(parsedJson.skills)) {
    profile.skills = parsedJson.skills.map(String).filter(Boolean);
  }

  if (Array.isArray(parsedJson.experience)) {
    profile.experience = parsedJson.experience.map((e: any) => ({
      company:     e.company     || e.employer    || '',
      title:       e.title       || e.role        || e.position || '',
      startDate:   e.startDate   || e.start       || '',
      endDate:     e.endDate     || e.end         || 'Present',
      description: e.description || e.summary     || '',
    }));
  }

  if (Array.isArray(parsedJson.education)) {
    profile.education = parsedJson.education.map((e: any) => ({
      institution: e.institution || e.school      || e.university || '',
      degree:      e.degree      || e.qualification || '',
      field:       e.field       || e.major        || '',
      startDate:   e.startDate   || e.start        || '',
      endDate:     e.endDate     || e.end          || '',
    }));
  }

  if (Array.isArray(parsedJson.certifications)) {
    profile.certifications = parsedJson.certifications.map(String).filter(Boolean);
  }

  if (Array.isArray(parsedJson.languages)) {
    profile.languages = parsedJson.languages.map(String).filter(Boolean);
  }

  if (Array.isArray(parsedJson.projects)) {
    profile.projects = parsedJson.projects.map((p: any) => ({
      name:         p.name        || '',
      description:  p.description || '',
      technologies: Array.isArray(p.technologies) ? p.technologies.map(String) : [],
    }));
  }

  profile.lastUpdatedFrom = 'resume_parse';
  profile.updatedAt = new Date();

  return profile;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractSection(text: string, headings: string[]): string | null {
  const escapedHeadings = headings.map((h) =>
    h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );
  // Match the section heading followed by its content until the next heading
  const pattern = new RegExp(
    `(?:^|\\n)(?:${escapedHeadings.join('|')})\\s*[:\\n]([\\s\\S]*?)(?=\\n(?:[A-Z][A-Z\\s]{2,}|${escapedHeadings.join('|')})\\s*[:\\n]|$)`,
    'i',
  );
  const match = text.match(pattern);
  return match ? match[1].trim() : null;
}

function parseExperienceSection(section: string): ExperienceItem[] {
  const items: ExperienceItem[] = [];
  // Split on lines that look like company/title headers (all-caps or Title Case)
  const blocks = section.split(
    /\n(?=[A-Z][A-Za-z\s&.,'-]{2,}(?:\s*[-–|]\s*|\n))/,
  );

  for (const block of blocks.slice(0, 8)) {
    const blockLines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (blockLines.length === 0) continue;

    const item: ExperienceItem = {};

    // Date range detection: "Jan 2020 – Mar 2023" or "2019-2021"
    const dateMatch = block.match(
      /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)?\.?\s*\d{4})\s*[-–to]+\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)?\.?\s*\d{4}|Present|Current)/i,
    );
    if (dateMatch) {
      item.startDate = dateMatch[1].trim();
      item.endDate   = dateMatch[2].trim();
    }

    // First non-date line as title, second as company (heuristic)
    const nonDateLines = blockLines.filter(
      (l) => !l.match(/\d{4}/) && l.length > 2,
    );
    if (nonDateLines[0]) item.title   = nonDateLines[0];
    if (nonDateLines[1]) item.company = nonDateLines[1];

    // Rest as description
    const descLines = blockLines.slice(2).filter((l) => l.length > 5);
    if (descLines.length) item.description = descLines.join(' ').slice(0, 400);

    if (item.title || item.company) items.push(item);
  }

  return items;
}

function parseEducationSection(section: string): EducationItem[] {
  const items: EducationItem[] = [];
  const blocks = section.split(/\n(?=[A-Z])/);

  for (const block of blocks.slice(0, 6)) {
    const blockLines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (blockLines.length === 0) continue;

    const item: EducationItem = {};

    const dateMatch = block.match(/(\d{4})\s*[-–to]*\s*(\d{4}|Present)?/i);
    if (dateMatch) {
      item.startDate = dateMatch[1];
      item.endDate   = dateMatch[2] || '';
    }

    const degreeMatch = block.match(
      /\b(B\.?Tech|M\.?Tech|B\.?E|M\.?E|B\.?Sc|M\.?Sc|MBA|PhD|Bachelor|Master|Diploma|B\.?Com|M\.?Com)\b/i,
    );
    if (degreeMatch) item.degree = degreeMatch[0];

    if (blockLines[0]) item.institution = blockLines[0];

    const fieldMatch = block.match(
      /(?:in|of)\s+(Computer Science|Information Technology|Electronics|Mechanical|Civil|[A-Z][a-z]+(?:\s[A-Z]?[a-z]+)*)/i,
    );
    if (fieldMatch) item.field = fieldMatch[1];

    if (item.institution || item.degree) items.push(item);
  }

  return items;
}
