/**
 * Pipeline Orchestrator — executes skill sequences with output chaining,
 * dependency enforcement, and failure halting as defined in the steering file.
 */

export interface SkillResult {
  skill: string;
  status: 'completed' | 'failed' | 'not-attempted';
  output?: Record<string, unknown>;
  error?: string;
}

export interface PipelineResult {
  completed: SkillResult[];
  failed: SkillResult | null;
  notAttempted: string[];
}

export interface SkillDependency {
  skill: string;
  requires: string | null; // predecessor skill name, or null for no dependency
}

export const SKILL_DEPENDENCIES: SkillDependency[] = [
  { skill: 'extract-pdf-data', requires: null },
  { skill: 'store-candidates-db', requires: 'extract-pdf-data' },
  { skill: 'generate-email-template', requires: null }, // requires user profile data, flexible source
  { skill: 'send-email', requires: 'generate-email-template' },
];

/**
 * Checks if a skill's dependency is satisfied by the outputs produced so far.
 * Returns null if satisfied, or the missing dependency skill name if not.
 */
export function checkDependency(
  skill: string,
  completedOutputs: Map<string, Record<string, unknown>>,
): string | null {
  const dep = SKILL_DEPENDENCIES.find((d) => d.skill === skill);
  if (!dep || dep.requires === null) return null;

  if (!completedOutputs.has(dep.requires)) {
    return dep.requires;
  }
  return null;
}

export type SkillExecutor = (
  skillName: string,
  input: Record<string, unknown>,
) => Promise<{ success: boolean; output?: Record<string, unknown>; error?: string }>;

/**
 * Executes a pipeline of skills in sequence:
 * 1. Pass complete output of skill K as input to skill K+1
 * 2. Halt on first failure
 * 3. Report completed, failed, and not-attempted skills
 */
export async function executePipeline(
  skillSequence: string[],
  initialInput: Record<string, unknown>,
  executor: SkillExecutor,
): Promise<PipelineResult> {
  const completed: SkillResult[] = [];
  const completedOutputs = new Map<string, Record<string, unknown>>();
  let currentInput = { ...initialInput };

  for (let i = 0; i < skillSequence.length; i++) {
    const skill = skillSequence[i];

    // Check dependency
    const missingDep = checkDependency(skill, completedOutputs);
    if (missingDep) {
      return {
        completed,
        failed: {
          skill,
          status: 'failed',
          error: `Dependency not satisfied: requires output from '${missingDep}'`,
        },
        notAttempted: skillSequence.slice(i + 1),
      };
    }

    // Execute skill
    const result = await executor(skill, currentInput);

    if (!result.success) {
      return {
        completed,
        failed: {
          skill,
          status: 'failed',
          error: result.error || 'Unknown error',
        },
        notAttempted: skillSequence.slice(i + 1),
      };
    }

    const output = result.output || {};
    completed.push({ skill, status: 'completed', output });
    completedOutputs.set(skill, output);

    // Chain output to next skill
    currentInput = { ...output };
  }

  return {
    completed,
    failed: null,
    notAttempted: [],
  };
}
