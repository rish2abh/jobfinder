/**
 * Step 7: Test inbox reading — fetchUnread standalone before wiring into agent loop.
 *
 * Tests IMAP connectivity and basic email classification without triggering
 * the full agent. This isolates IMAP config issues from Gemini/agent issues.
 *
 * Run: npx ts-node -r tsconfig-paths/register src/scripts/test-inbox-reader.ts <userId>
 *
 * Prerequisites:
 *   - IMAP_HOST, IMAP_USER, IMAP_PASS must be set in .env
 *   - Some unread emails in the inbox (ideally from job boards / recruiters)
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { InboxReaderService } from '../agent/tools/inbox-reader.service';

async function main() {
  const userId = process.argv[2];

  if (!userId) {
    console.error('Usage: npx ts-node ... src/scripts/test-inbox-reader.ts <userId>');
    process.exit(1);
  }

  console.log(`\n📬 Inbox Reader Test`);
  console.log(`   User: ${userId}`);
  console.log(`   IMAP Host: ${process.env.IMAP_HOST || '(not set)'}`);
  console.log(`   IMAP User: ${process.env.IMAP_USER || '(not set)'}`);
  console.log('─'.repeat(60));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const inboxReader = app.get(InboxReaderService);

  // ── Test 1: Stats (doesn't require IMAP) ─────────────────────────────────
  console.log('\n📊 Test 1: Mail stats (no IMAP needed)...');
  try {
    const stats = await inboxReader.execute({ userId, action: 'stats' });
    console.log(`  ✅ Stats:`, JSON.stringify(stats, null, 2).slice(0, 300));
  } catch (err: any) {
    console.error(`  ❌ Failed: ${err.message}`);
  }

  // ── Test 2: History (no IMAP needed) ──────────────────────────────────────
  console.log('\n📜 Test 2: Mail history...');
  try {
    const history = await inboxReader.execute({ userId, action: 'history' });
    const h = history as any;
    if (Array.isArray(h)) {
      console.log(`  ✅ Found ${h.length} past mail jobs`);
      for (const item of h.slice(0, 3)) {
        console.log(`    • [${item.status}] ${item.subject?.slice(0, 40) || item._id}`);
      }
    } else {
      console.log(`  ✅ Result:`, JSON.stringify(h).slice(0, 200));
    }
  } catch (err: any) {
    console.error(`  ❌ Failed: ${err.message}`);
  }

  // ── Test 3: poll_replies (requires IMAP) ──────────────────────────────────
  console.log('\n📨 Test 3: Poll replies (IMAP connection + Gemini classification)...');
  console.log('   ⏳ Connecting to IMAP and fetching unseen messages...');

  if (!process.env.IMAP_HOST || !process.env.IMAP_USER || !process.env.IMAP_PASS) {
    console.log('   ⚠️  IMAP not configured — skipping poll_replies test');
    console.log('   Set IMAP_HOST, IMAP_USER, IMAP_PASS in .env to test');
  } else {
    try {
      const pollResult = await inboxReader.execute({
        userId,
        action: 'poll_replies',
        limit: 5, // Only process a few for testing
      });

      const pr = pollResult as any;
      console.log(`\n  ✅ Poll completed!`);
      console.log(`  📋 Status: ${pr.status}`);
      console.log(`  📊 Classified: ${pr.classified ?? 0}`);
      console.log(`  📝 Drafts created: ${pr.draftsCreated ?? 0}`);

      if (pr.messages?.length > 0) {
        console.log('\n  📧 Messages processed:');
        for (const msg of pr.messages) {
          console.log(`    • From: ${msg.from?.slice(0, 40)}`);
          console.log(`      Subject: ${msg.subject?.slice(0, 50)}`);
          console.log(`      Category: ${msg.classification?.category} (${(msg.classification?.confidence * 100).toFixed(0)}%)`);
          console.log(`      Summary: ${msg.classification?.summary?.slice(0, 80)}`);
          console.log(`      Should reply: ${msg.classification?.shouldReply}`);
          if (msg.draftId) console.log(`      Draft ID: ${msg.draftId}`);
          console.log('');
        }
      }
    } catch (err: any) {
      console.error(`  ❌ Failed: ${err.message}`);
      if (err.message.includes('IMAP') || err.message.includes('connect')) {
        console.log('  💡 Check your IMAP credentials and make sure:');
        console.log('     - IMAP is enabled in your Gmail settings');
        console.log('     - You\'re using an App Password (not your real password)');
        console.log('     - Less secure app access is enabled OR you\'re using OAuth');
      }
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log('✅ Inbox reader test complete!\n');

  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
