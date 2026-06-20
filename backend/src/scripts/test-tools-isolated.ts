/**
 * Step 2: Test search_jobs and recompute_matches tools in isolation.
 *
 * This script boots a minimal NestJS app, resolves the tool services,
 * and calls them directly — no agent loop, no Gemini.
 *
 * Run: npx ts-node -r tsconfig-paths/register src/scripts/test-tools-isolated.ts
 *
 * Requires:
 *   - MongoDB running (MONGODB_URI in .env)
 *   - Redis running (REDIS_URL in .env)
 *   - A user with a valid profile and at least some scraped jobs
 *
 * Pass your userId as first CLI arg:
 *   npx ts-node -r tsconfig-paths/register src/scripts/test-tools-isolated.ts <userId>
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { JobTools } from '../agent/tools/job-tools';

async function main() {
  const userId = process.argv[2];
  if (!userId) {
    console.error('Usage: npx ts-node ... src/scripts/test-tools-isolated.ts <userId>');
    process.exit(1);
  }

  console.log(`\n🧪 Testing tools in isolation for userId: ${userId}`);
  console.log('─'.repeat(60));

  // Boot NestJS in non-listening mode (no HTTP)
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const jobTools = app.get(JobTools);

  // ── Test 1: search_jobs (search action — cached only) ─────────────────────
  console.log('\n📋 Test 1: search_jobs — action=search, skills=["react","node"]');
  try {
    const searchResult = await jobTools.execute({
      userId,
      action: 'search',
      skills: ['react', 'node'],
      limit: 5,
    });
    console.log(`  ✅ Result:`, JSON.stringify(searchResult, null, 2).slice(0, 500));
  } catch (err: any) {
    console.error(`  ❌ Failed: ${err.message}`);
  }

  // ── Test 2: search_jobs (get_scores — existing cached scores) ─────────────
  console.log('\n📊 Test 2: search_jobs — action=get_scores');
  try {
    const scoresResult = await jobTools.execute({
      userId,
      action: 'get_scores',
      limit: 5,
    });
    console.log(`  ✅ Result:`, JSON.stringify(scoresResult, null, 2).slice(0, 500));
  } catch (err: any) {
    console.error(`  ❌ Failed: ${err.message}`);
  }

  // ── Test 3: search_jobs (recompute_scores — enqueue + poll) ───────────────
  console.log('\n🔄 Test 3: search_jobs — action=recompute_scores (enqueue + poll)');
  console.log('  ⏳ This may take 30-90s depending on job count...');
  try {
    const recomputeResult = await jobTools.execute({
      userId,
      action: 'recompute_scores',
    });
    console.log(`  ✅ Result:`, JSON.stringify(recomputeResult, null, 2).slice(0, 500));
  } catch (err: any) {
    console.error(`  ❌ Failed: ${err.message}`);
  }

  // ── Test 4: search_jobs (scrape — triggers scrape + poll) ─────────────────
  console.log('\n🌐 Test 4: search_jobs — action=scrape (trigger scrape + poll)');
  console.log('  ⏳ This requires Playwright and may take 30-60s...');
  console.log('  ℹ️  Skipping by default — uncomment below to test\n');
  /*
  try {
    const scrapeResult = await jobTools.execute({
      userId,
      action: 'scrape',
      skills: ['react'],
      sources: ['jsearch'],
      limit: 3,
    });
    console.log(`  ✅ Result:`, JSON.stringify(scrapeResult, null, 2).slice(0, 500));
  } catch (err: any) {
    console.error(`  ❌ Failed: ${err.message}`);
  }
  */

  console.log('\n' + '─'.repeat(60));
  console.log('✅ Tool isolation tests complete!\n');

  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
