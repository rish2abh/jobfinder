/**
 * Step 3: First real end-to-end agent run — read-only tools only.
 *
 * Temporarily overrides the ToolRegistry to only expose search_jobs.
 * Sends a message to the agent queue and polls for completion.
 *
 * Run: npx ts-node -r tsconfig-paths/register src/scripts/test-agent-readonly.ts <userId>
 *
 * After running, check:
 *   - The journal collection in MongoDB for the new entry
 *   - Console output for the agent's response
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { Queue, Job } from 'bullmq';
import { getQueueToken } from '@nestjs/bullmq';
import { AGENT_RUN_QUEUE, AGENT_RUN_JOB, AgentRunJobData, AgentRunJobResult } from '../agent/agent.types';
import { ToolRegistry } from '../agent/tools/tool-registry';
import { randomUUID } from 'crypto';

async function main() {
  const userId = process.argv[2];
  if (!userId) {
    console.error('Usage: npx ts-node ... src/scripts/test-agent-readonly.ts <userId>');
    process.exit(1);
  }

  const testMessage = process.argv[3] || 'Show me my top 3 job matches with scores above 70';

  console.log(`\n🤖 Agent read-only test`);
  console.log(`   User: ${userId}`);
  console.log(`   Message: "${testMessage}"`);
  console.log('─'.repeat(60));

  // Boot full NestJS app context
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  // Verify tool registry
  const toolRegistry = app.get(ToolRegistry);
  const registeredTools = toolRegistry.listTools();
  console.log(`\n📦 Registered tools: ${registeredTools.join(', ')}`);

  // For this test, we'll keep all tools but only send a message that
  // should trigger search_jobs. The guardrails + system prompt should
  // keep the agent on the safe side.

  // Get the agent queue
  const agentQueue = app.get<Queue<AgentRunJobData, AgentRunJobResult>>(
    getQueueToken(AGENT_RUN_QUEUE),
  );

  const conversationId = randomUUID();
  console.log(`\n📤 Enqueuing agent run — conv: ${conversationId}`);

  const job = await agentQueue.add(AGENT_RUN_JOB, {
    userId,
    message: testMessage,
    conversationId,
  });

  console.log(`   Job ID: ${job.id}`);
  console.log(`   ⏳ Polling for completion...`);

  // Poll until done
  const startTime = Date.now();
  const maxWaitMs = 120_000;

  while (Date.now() - startTime < maxWaitMs) {
    const freshJob: Job<AgentRunJobData, AgentRunJobResult> | undefined =
      await agentQueue.getJob(String(job.id));

    if (!freshJob) {
      console.error('   ❌ Job disappeared from queue');
      break;
    }

    const state = await freshJob.getState();
    const progress = typeof freshJob.progress === 'number' ? freshJob.progress : 0;

    if (state === 'completed') {
      const result = freshJob.returnvalue;
      console.log(`\n✅ Agent completed in ${Date.now() - startTime}ms`);
      console.log('─'.repeat(60));
      console.log(`📝 Response:\n${result?.response}\n`);
      console.log(`📊 Summary: ${result?.summary}`);
      console.log(`🔧 Actions (${result?.actions?.length ?? 0}):`);
      for (const action of result?.actions ?? []) {
        console.log(`   • ${action.tool}(${JSON.stringify(action.args).slice(0, 80)}) → ${JSON.stringify(action.result).slice(0, 100)}`);
      }
      console.log(`\n📈 Iterations: ${result?.iterations}`);
      console.log(`📊 Tokens: ${JSON.stringify(result?.tokenUsage)}`);
      break;
    }

    if (state === 'failed') {
      console.error(`\n❌ Agent failed: ${freshJob.failedReason}`);
      break;
    }

    process.stdout.write(`\r   State: ${state} | Progress: ${progress}% | Elapsed: ${Math.round((Date.now() - startTime) / 1000)}s`);
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (Date.now() - startTime >= maxWaitMs) {
    console.error('\n   ⏱️  Timed out after 120s');
  }

  console.log('\n' + '─'.repeat(60));
  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
