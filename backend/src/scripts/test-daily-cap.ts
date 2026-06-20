/**
 * Step 4: Test that the daily cap guardrail actually blocks.
 *
 * Temporarily sets AGENT_AUTO_APPLY_DAILY_CAP=1 via env override, then:
 *   1. Calls auto_apply (apply_single) — should succeed (or fail for other reasons)
 *   2. Calls auto_apply again — should be blocked by the daily cap
 *
 * Run: npx ts-node -r tsconfig-paths/register src/scripts/test-daily-cap.ts <userId> <jobId>
 *
 * If you don't have a jobId handy, run test-tools-isolated.ts first and
 * pick one from the search results.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ApplyTools } from '../agent/tools/apply-tools';

// Force daily cap to 1 for this test
process.env.AGENT_AUTO_APPLY_DAILY_CAP = '1';

async function main() {
  const userId = process.argv[2];
  const jobId = process.argv[3];

  if (!userId || !jobId) {
    console.error('Usage: npx ts-node ... src/scripts/test-daily-cap.ts <userId> <jobId>');
    console.error('  (Get a jobId from test-tools-isolated.ts search results)');
    process.exit(1);
  }

  console.log(`\n🛡️  Daily Cap Guardrail Test`);
  console.log(`   User: ${userId}`);
  console.log(`   Job: ${jobId}`);
  console.log(`   Cap: 1 (forced for testing)`);
  console.log('─'.repeat(60));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const applyTools = app.get(ApplyTools);

  // ── Attempt 1: Should either succeed or fail for a non-cap reason ─────────
  console.log('\n🔨 Attempt 1: First apply call...');
  try {
    const result1 = await applyTools.execute({
      userId,
      action: 'apply_single',
      jobId,
    });
    console.log(`  Result:`, JSON.stringify(result1, null, 2).slice(0, 400));

    const r1 = result1 as any;
    if (r1.blocked) {
      // Could already be at cap if previous tests ran today
      console.log(`  ⚠️  Already blocked on first attempt: ${r1.reason}`);
      console.log('  ✅ This means the cap IS working (previous test already used it)');
    } else {
      console.log('  ✅ First attempt went through (either queued or skipped for other reasons)');
    }
  } catch (err: any) {
    console.error(`  ❌ Unexpected error: ${err.message}`);
  }

  // ── Attempt 2: Should be blocked by daily cap ─────────────────────────────
  console.log('\n🛑 Attempt 2: Second apply call (should be blocked by cap)...');
  try {
    const result2 = await applyTools.execute({
      userId,
      action: 'apply_single',
      jobId,
    });
    const r2 = result2 as any;

    if (r2.blocked && r2.reason?.includes('cap')) {
      console.log(`  ✅ BLOCKED as expected: ${r2.reason}`);
      console.log(`  📊 Today's count: ${r2.todayCount}, Cap: ${r2.dailyCap}`);
    } else if (r2.blocked) {
      console.log(`  ⚠️  Blocked but not by cap: ${r2.reason}`);
    } else if (r2.status === 'skipped') {
      console.log(`  ⚠️  Skipped (already applied): ${r2.reason}`);
      console.log('  ℹ️  The cap logic ran before this check — if you got here, cap let it through.');
      console.log('  🔍 Check: was the first attempt also skipped? If so, cap was never tested.');
    } else {
      console.log(`  ❌ NOT BLOCKED — cap guardrail may be broken!`);
      console.log(`  Result:`, JSON.stringify(result2, null, 2).slice(0, 300));
    }
  } catch (err: any) {
    console.error(`  ❌ Unexpected error: ${err.message}`);
  }

  // ── Also test get_stats for completeness ──────────────────────────────────
  console.log('\n📊 Application stats for context:');
  try {
    const stats = await applyTools.execute({ userId, action: 'get_stats' });
    console.log(`  ${JSON.stringify(stats)}`);
  } catch (err: any) {
    console.error(`  ❌ ${err.message}`);
  }

  console.log('\n' + '─'.repeat(60));
  console.log('✅ Daily cap test complete!\n');

  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
