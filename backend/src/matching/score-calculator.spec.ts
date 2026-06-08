import { computeMatchScore } from './score-calculator';

describe('computeMatchScore', () => {
  it('should return 0 when cosine is 0 and no skill overlap', () => {
    const result = computeMatchScore(0, ['typescript'], ['python']);
    expect(result.finalScore).toBe(0);
    expect(result.skillOverlap).toBe(0);
  });

  it('should return 100 when cosine is 1 and all skills match', () => {
    const result = computeMatchScore(1, ['typescript', 'node'], ['typescript', 'node']);
    expect(result.finalScore).toBe(100);
    expect(result.skillOverlap).toBe(1);
  });

  it('should compute correct score with partial skill overlap', () => {
    // cosine = 0.8, skills: 2 of 4 match => skillOverlap = 0.5
    // score = round((0.7 * 0.8 + 0.3 * 0.5) * 100) = round((0.56 + 0.15) * 100) = round(71) = 71
    const result = computeMatchScore(
      0.8,
      ['typescript', 'node', 'react', 'python'],
      ['typescript', 'node', 'java', 'rust'],
    );
    expect(result.finalScore).toBe(71);
    expect(result.skillOverlap).toBe(0.5);
  });

  it('should handle case-insensitive skill matching', () => {
    const result = computeMatchScore(0.5, ['TypeScript', 'NODE'], ['typescript', 'node']);
    expect(result.skillOverlap).toBe(1);
    // score = round((0.7 * 0.5 + 0.3 * 1) * 100) = round((0.35 + 0.3) * 100) = round(65) = 65
    expect(result.finalScore).toBe(65);
  });

  it('should return skillOverlap of 0 when resumeSkills is empty', () => {
    const result = computeMatchScore(0.9, [], ['typescript', 'node']);
    expect(result.skillOverlap).toBe(0);
    // score = round((0.7 * 0.9 + 0.3 * 0) * 100) = round(63) = 63
    expect(result.finalScore).toBe(63);
  });

  it('should return skillOverlap of 0 when jobKeywords is empty', () => {
    const result = computeMatchScore(0.6, ['typescript', 'node'], []);
    expect(result.skillOverlap).toBe(0);
    // score = round((0.7 * 0.6 + 0.3 * 0) * 100) = round(42) = 42
    expect(result.finalScore).toBe(42);
  });

  it('should clamp score to 0 when cosine is negative (edge case)', () => {
    const result = computeMatchScore(-0.5, [], []);
    expect(result.finalScore).toBe(0);
  });

  it('should clamp score to 100 when inputs would exceed 100', () => {
    // If cosine were > 1 (invalid but testing clamping)
    const result = computeMatchScore(1.5, ['ts'], ['ts']);
    // raw = (0.7 * 1.5 + 0.3 * 1) * 100 = (1.05 + 0.3) * 100 = 135
    expect(result.finalScore).toBe(100);
  });

  it('should handle both arrays empty with cosine 0', () => {
    const result = computeMatchScore(0, [], []);
    expect(result.finalScore).toBe(0);
    expect(result.skillOverlap).toBe(0);
  });

  it('should correctly round the final score', () => {
    // cosine = 0.33, skills: 1 of 3 match => skillOverlap = 1/3
    // score = round((0.7 * 0.33 + 0.3 * 0.3333) * 100) = round((0.231 + 0.1) * 100) = round(33.1) = 33
    const result = computeMatchScore(
      0.33,
      ['a', 'b', 'c'],
      ['a', 'x', 'y'],
    );
    expect(result.skillOverlap).toBeCloseTo(1 / 3);
    expect(result.finalScore).toBe(33);
  });
});
