/**
 * Step 6: Approve a draft and confirm a real email lands.
 *
 * Calls the approve endpoint logic directly (same as POST /agent/drafts/:id/approve),
 * then polls the mail queue job for completion.
 *
 * ⚠️  This WILL send a real email! Use a draft addressed to YOURSELF for testing.
 *
 * Run: npx ts-node -r tsconfig-paths/register src/scripts/test-approve-send.ts <userId> <draftId>
 *
 * Prerequisites:
 *   - A pending draft must exist (create one with test-cold-email-drafts.ts)
 *   - The draft's recipient should be YOUR email address for safe testing
 *   - SMTP credentials must be configured in .env
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DraftRepository } from '../agent/drafts/draft.repository';
import { Queue, Job } from 'bullmq';
import { getQueueToken } from '@nestjs/bullmq';
import { MAIL_QUEUE, AGENT_MAIL_JOB, AgentMailJobData, AgentMailJobResult } from '../mail/mail-job.types';

async function main() {
  const userId = process.argv[2];
  const draftId = process.argv[3];

  if (!userId || !draftId) {
    console.error('Usage: npx ts-node ... src/scripts/test-approve-send.ts <userId> <draftId>');
    console.error('\n⚠️  This will send a REAL email. Make sure the draft recipient is YOUR address.');
    process.exit(1);
  }

  console.log(`\n📮 Approve & Send Test`);
  console.log(`   User: ${userId}`);
  console.log(`   Draft: ${draftId}`);
  console.log('─'.repeat(60));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const draftRepo = app.get(DraftRepository);
  const mailQueue = app.get<Queue<AgentMailJobData, AgentMailJobResult>>(
    getQueueToken(MAIL_QUEUE),
  );

  // ── Verify draft exists and is in approvable state ────────────────────────
  console.log('\n🔍 Looking up draft...');
  const draft = await draftRepo.findById(draftId);

  if (!draft) {
    console.error(`  ❌ Draft ${draftId} not found`);
    await app.close();
    process.exit(1);
  }

  if (draft.userId !== userId) {
    console.error(`  ❌ Draft belongs to different user (${draft.userId})`);
    await app.close();
    process.exit(1);
  }

  console.log(`  📬 Recipient: ${draft.recipient}`);
  console.log(`  📝 Subject: ${draft.subject}`);
  console.log(`  📋 Status: ${draft.status}`);
  console.log(`  📄 Body preview: ${draft.body.slice(0, 150)}...`);

  if (draft.status !== 'pending' && draft.status !== 'edited') {
    console.error(`  ❌ Cannot approve draft with status "${draft.status}". Only pending/edited allowed.`);
    await app.close();
    process.exit(1);
  }

  // ── Safety check: confirm recipient ───────────────────────────────────────
  const smtpUser = process.env.SMTP_USER || '';
  if (draft.recipient.toLowerCase() !== smtpUser.toLowerCase()) {
    console.log(`\n  ⚠️  WARNING: Draft recipient (${draft.recipient}) is NOT your SMTP_USER (${smtpUser})`);
    console.log(`  This will send a real email to a potentially unknown address.`);
    console.log(`  Press Ctrl+C within 5 seconds to abort...`);
    await new Promise((r) => setTimeout(r, 5000));
  }

  // ── Approve and enqueue ───────────────────────────────────────────────────
  console.log('\n✅ Approving draft and enqueuing for send...');
  await draftRepo.update(draftId, { status: 'approved' });

  const mailJob = await mailQueue.add(
    AGENT_MAIL_JOB,
    {
      draftId,
      userId,
      recipientEmail: draft.recipient,
      subject: draft.subject,
      body: draft.body,
    },
    {
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 60 * 60 * 24, count: 200 },
      removeOnFail: { age: 60 * 60 * 24 * 3 },
    },
  );

  console.log(`  📤 Mail job enqueued: ${mailJob.id}`);

  // ── Poll until sent ───────────────────────────────────────────────────────
  console.log('  ⏳ Waiting for mail delivery...');
  const startTime = Date.now();
  const maxWaitMs = 30_000;

  while (Date.now() - startTime < maxWaitMs) {
    const freshJob: Job<AgentMailJobData, AgentMailJobResult> | undefined =
      await mailQueue.getJob(String(mailJob.id));

    if (!freshJob) {
      console.error('  ❌ Mail job disappeared');
      break;
    }

    const state = await freshJob.getState();

    if (state === 'completed') {
      const result = freshJob.returnvalue;
      console.log(`\n  ✅ Email sent!`);
      console.log(`  📬 To: ${result?.recipientEmail}`);
      console.log(`  📋 Status: ${result?.status}`);
      break;
    }

    if (state === 'failed') {
      console.error(`\n  ❌ Email failed: ${freshJob.failedReason}`);
      break;
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  if (Date.now() - startTime >= maxWaitMs) {
    console.log('  ⏱️  Timed out — check mail queue manually');
  }

  // ── Verify draft status updated ──────────────────────────────────────────
  console.log('\n🔍 Final draft status:');
  const finalDraft = await draftRepo.findById(draftId);
  console.log(`  Status: ${finalDraft?.status}`);

  console.log('\n' + '─'.repeat(60));
  console.log('✅ Approve & send test complete!\n');

  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
