/**
 * Builds a deduplicated list of search query strings from skills, companies, and keywords.
 *
 * Strategy:
 *
 *   No companies provided:
 *     - "React Node.js MongoDB"         (top 3 skills)
 *     - "React developer"               (top skill + developer)
 *     - "React Node.js"                 (pair, if 4+ skills)
 *
 *   Companies provided:
 *     For each company × top skill/keyword combos:
 *     - "React developer jobs at Google"
 *     - "React Node.js Microsoft"
 *     - "Software Engineer Google"      (fallback when no skills)
 *
 *   Keywords provided:
 *     Keywords are injected into every query:
 *     - "React remote senior developer"
 */
export function buildSearchQueries(
  skills: string[],
  companies: string[] = [],
  keywords: string[] = [],
): string[] {
  const cleanSkills   = skills.map((s) => s.trim()).filter(Boolean).slice(0, 8);
  const cleanCompanies = companies.map((c) => c.trim()).filter(Boolean).slice(0, 10);
  const cleanKeywords  = keywords.map((k) => k.trim()).filter(Boolean).slice(0, 5);

  const kwSuffix = cleanKeywords.length > 0 ? ` ${cleanKeywords.join(' ')}` : '';
  const queries  = new Set<string>();

  if (cleanCompanies.length === 0) {
    // General search without company targeting
    if (cleanSkills.length === 0) {
      queries.add(`software developer${kwSuffix}`);
    } else {
      queries.add(`${cleanSkills.slice(0, 3).join(' ')}${kwSuffix}`);
      queries.add(`${cleanSkills[0]} developer${kwSuffix}`);
      if (cleanSkills.length >= 4) {
        queries.add(`${cleanSkills[0]} ${cleanSkills[1]}${kwSuffix}`);
      }
    }
  } else {
    // Company-targeted search
    for (const company of cleanCompanies) {
      if (cleanSkills.length === 0 && cleanKeywords.length === 0) {
        queries.add(`Software Engineer jobs at ${company}`);
        queries.add(`developer jobs at ${company}`);
      } else if (cleanSkills.length > 0) {
        // Primary: top skill + company
        queries.add(`${cleanSkills[0]} developer jobs at ${company}${kwSuffix}`);
        // Secondary: top 2 skills + company
        if (cleanSkills.length >= 2) {
          queries.add(`${cleanSkills.slice(0, 2).join(' ')} ${company}${kwSuffix}`);
        }
      } else {
        // Keywords only, no skills
        queries.add(`${cleanKeywords.join(' ')} jobs at ${company}`);
      }
    }
  }

  return [...queries].filter(Boolean);
}

/**
 * Scores how many of the user's skills appear in a job title or JD text.
 * Case-insensitive whole-word matching.
 */
export function matchSkills(skills: string[], text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  return skills
    .filter((s) => {
      const term = s.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${term}\\b`).test(lower);
    })
    .map((s) => s.toLowerCase());
}

/**
 * Builds a Google Jobs search URL for a given query.
 * Google's job search widget (ibp=htl;jobs) returns structured job cards
 * with direct apply links.
 */
export function buildGoogleJobsUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query + ' jobs')}&ibp=htl;jobs`;
}
