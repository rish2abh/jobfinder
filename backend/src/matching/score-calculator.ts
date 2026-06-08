/**
 * Pure function to compute a job-resume match score.
 *
 * Formula: finalScore = round((0.7 * cosineSimilarity + 0.3 * skillOverlap) * 100)
 * - cosineSimilarity: 0-1 value from vector similarity
 * - skillOverlap: ratio of case-insensitive exact skill matches to total resume skills
 * - finalScore is clamped to [0, 100]
 *
 * @param cosineSimilarity - Cosine similarity between profile and job embeddings (0-1)
 * @param resumeSkills - Array of skills from the user's resume
 * @param jobKeywords - Array of keywords from the job description
 * @returns Object with finalScore (0-100) and skillOverlap (0-1)
 */
export function computeMatchScore(
  cosineSimilarity: number,
  resumeSkills: string[],
  jobKeywords: string[],
): { finalScore: number; skillOverlap: number } {
  const matchedSkills = resumeSkills.filter((skill) =>
    jobKeywords.some((kw) => kw.toLowerCase() === skill.toLowerCase()),
  );

  const skillOverlap =
    resumeSkills.length > 0 ? matchedSkills.length / resumeSkills.length : 0;

  const rawScore = (0.7 * cosineSimilarity + 0.3 * skillOverlap) * 100;
  const finalScore = Math.min(100, Math.max(0, Math.round(rawScore)));

  return { finalScore, skillOverlap };
}
