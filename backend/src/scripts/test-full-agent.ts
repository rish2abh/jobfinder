/**
 * Step 8: Full agent run with all tools — observe what it decides.
 *
 * Sends varied prompts to the agent and prints the full journal output.
 * Run this a few times with different messages to see if the agent
 * makes sensible decisions.
 *
 * Run: npx ts-node -r tsconfig-paths/register src/scripts/test-full-agent.ts <userId> [message]
 *
 * Example messages to test:
 *   "Find me React jobs in Bangalore and show my top matches"
 *   "Draft a cold email to my top contact about the highest-scoring job"
 *   "Check my inbox for recruiter replies"
 *   "Apply to my top-scoring job"
 *   "What's the status of my recent applications?"
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { Queue, Job } from 'bullmq';
import { getQueueToken } from '@nestjs/bullmq';
import { AGENT_RUN_QUEUE, AGENT_RUN_JOB, AgentRunJobData, AgentRunJobResult } from '../agent/agent.types';
import { AgentJournalRepository } from '../agent/journal/agent-journal.repository';
import { ToolRegistry } from '../agent/tools/tool-registry';
import { randomUUID } from 'crypto';

const DEFAULT_MESSAGES = [
  'Show me my top 5 job matches and their scores',
  'What jobs have I applied to recently? Any updates?',
  'Check my inbox for any recruiter replies',
];

async function main() {
  const userId = process.argv[2];
  const customMessage = process.argv.slice(3).join(' ');

  if (!userId) {
    console.error('Usage: npx ts-node ... src/scripts/test-full-agent.ts <userId> [message]');
    console.error('\nOmit message to run 3 default test prompts sequentially.');
    process.exit(1);
  }

  const messages = customMessage ? [customMessage] : DEFAULT_MESSAGES;

  console.log(`\n🤖 Full Agent Integration Test`);
  console.log(`   User: ${userId}`);
  console.log(`   Messages to test: ${messages.length}`);
  console.log('═'.repeat(60));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const agentQueue = app.get<Queue<AgentRunJobData, AgentRunJobResult>>(
    getQueueToken(AGENT_RUN_QUEUE),
  );
  const journalRepo = app.get(AgentJournalRepository);
  const toolRegistry = app.get(ToolRegistry);

  console.log(`\n📦 Registered tools: ${toolRegistry.listTools().join(', ')}`);

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const conversationId = randomUUID();

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📤 Test ${i + 1}/${messages.length}: "${message}"`);
    console.log(`   Conv: ${conversationId}`);

    const job = await agentQueue.add(AGENT_RUN_JOB, {
      userId,
      message,
      conversationId,
    });

    console.log(`   Job: ${job.id}`);
    console.log(`   ⏳ Running...`);

    // Poll
    const startTime = Date.now();
    const maxWaitMs = 120_000;
    let finalState = 'unknown';

    while (Date.now() - startTime < maxWaitMs) {
      const freshJob: Job<AgentRunJobData, AgentRunJobResult> | undefined =
        await agentQueue.getJob(String(job.id));

      if (!freshJob) break;

      const state = await freshJob.getState();

      if (state === 'completed') {
        finalState = 'completed';
        const result = freshJob.returnvalue;
        const elapsed = Date.now() - startTime;

        console.log(`\n   ✅ Completed in ${elapsed}ms`);
        console.log(`   📝 Response:`);
        console.log(`   ${result?.response?.replace(/\n/g, '\n   ')}`);
        console.log(`\n   📊 Stats:`);
        console.log(`      Iterations: ${result?.iterations}`);
        console.log(`      Actions: ${result?.actions?.length}`);
        console.log(`      Tokens: ${result?.tokenUsage?.total ?? 'N/A'}`);

        if (result?.actions?.length) {
          console.log(`\n   🔧 Tool calls:`);
          for (const action of result.actions) {
            const argStr = JSON.stringify(action.args);
            const resultStr = JSON.stringify(action.result);
            console.log(`      • ${action.tool} (${action.durationMs}ms)`);
            console.log(`        Args: ${argStr.slice(0, 120)}${argStr.length > 120 ? '...' : ''}`);
            console.log(`        Result: ${resultStr.slice(0, 120)}${resultStr.length > 120 ? '...' : ''}`);
          }
        }
        break;
      }

      if (state === 'failed') {
        finalState = 'failed';
        console.error(`\n   ❌ Failed: ${freshJob.failedReason}`);
        break;
      }

      await new Promise((r) => setTimeout(r, 3000));
    }

    if (finalState === 'unknown') {
      console.error('   ⏱️  Timed out');
    }

    // Brief pause between runs to avoid overlapping
    if (i < messages.length - 1) {
      console.log('\n   ⏸️  Waiting 3s before next message...');
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  // ── Summary: recent journal entries ───────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`);
  console.log('📓 Recent journal entries:');
  const { entries } = await journalRepo.findByUser(userId, { limit: messages.length + 2 });
  for (const entry of entries) {
    console.log(`  [${entry.timestamp}] ${entry.summary?.slice(0, 80)}`);
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log('✅ Full agent test complete!\n');

  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
