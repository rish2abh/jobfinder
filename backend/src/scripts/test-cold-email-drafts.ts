/**
 * Step 5: Test cold email drafter — confirm drafts appear in the DB.
 *
 * Calls draft_cold_email directly, then verifies the draft exists via DraftRepository.
 *
 * Run: npx ts-node -r tsconfig-paths/register src/scripts/test-cold-email-drafts.ts <userId> <contactId> [jobId]
 *
 * Prerequisites:
 *   - A BulkContact record must exist for this user. Get one from:
 *     db.bulkcontacts.find({ userId: "<userId>" }).limit(1)
 *   - Optionally pass a jobId for more personalized results.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ColdEmailDrafterService } from '../agent/tools/cold-email-drafter.service';
import { DraftRepository } from '../agent/drafts/draft.repository';

async function main() {
  const userId = process.argv[2];
  const contactId = process.argv[3];
  const jobId = process.argv[4]; // optional

  if (!userId || !contactId) {
    console.error('Usage: npx ts-node ... src/scripts/test-cold-email-drafts.ts <userId> <contactId> [jobId]');
    console.error('\nGet a contactId from: db.bulkcontacts.find({ userId: "..." }).limit(1)');
    process.exit(1);
  }

  console.log(`\n📧 Cold Email Draft Test`);
  console.log(`   User: ${userId}`);
  console.log(`   Contact: ${contactId}`);
  if (jobId) console.log(`   Job: ${jobId}`);
  console.log('─'.repeat(60));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const coldEmailDrafter = app.get(ColdEmailDrafterService);
  const draftRepo = app.get(DraftRepository);

  // ── Call the drafter ──────────────────────────────────────────────────────
  console.log('\n✍️  Drafting cold email via Gemini...');
  try {
    const result = await coldEmailDrafter.execute({
      userId,
      contactId,
      jobId,
      customContext: 'Mention my open-source contributions and full-stack experience',
    });

    const r = result as any;
    console.log(`\n  Status: ${r.status || r.error}`);

    if (r.status === 'draft_created') {
      console.log(`  ✅ Draft created!`);
      console.log(`  📬 Recipient: ${r.recipient} (${r.recipientEmail})`);
      console.log(`  🏢 Company: ${r.company}`);
      console.log(`  📝 Subject: ${r.subject}`);
      console.log(`  🔑 Draft ID: ${r.draftId}`);

      // Verify via repository
      console.log('\n🔍 Verifying via DraftRepository...');
      const draft = await draftRepo.findById(r.draftId);
      if (draft) {
        console.log(`  ✅ Draft found in DB!`);
        console.log(`  📋 Status: ${draft.status}`);
        console.log(`  📝 Subject: ${draft.subject}`);
        console.log(`  📄 Body preview: ${draft.body.slice(0, 200)}...`);
        console.log(`  🕐 Created: ${draft.createdAt}`);
      } else {
        console.error('  ❌ Draft NOT found in DB — persistence issue!');
      }
    } else if (r.status === 'skipped') {
      console.log(`  ⚠️  Skipped: ${r.reason}`);
      console.log(`  Existing draft ID: ${r.existingDraftId}`);
    } else {
      console.log(`  ❌ Error: ${JSON.stringify(r).slice(0, 300)}`);
    }
  } catch (err: any) {
    console.error(`  ❌ Exception: ${err.message}`);
  }

  // ── List all pending drafts ───────────────────────────────────────────────
  console.log('\n📋 All pending drafts for this user:');
  try {
    const pending = await draftRepo.findPending(userId);
    console.log(`  Found: ${pending.length} pending drafts`);
    for (const d of pending.slice(0, 5)) {
      console.log(`  • [${d._id}] To: ${d.recipient} | Subject: ${d.subject.slice(0, 50)}...`);
    }
  } catch (err: any) {
    console.error(`  ❌ ${err.message}`);
  }

  console.log('\n' + '─'.repeat(60));
  console.log('✅ Cold email draft test complete!\n');

  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
