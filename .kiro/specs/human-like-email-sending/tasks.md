# Implementation Plan: Human-Like Email Sending

## Overview

This plan implements a randomized batch-based email sending pattern that replaces the existing fixed-rate 12-second stagger. The implementation builds up from pure randomization logic, through configuration and persistence layers, to the orchestrating scheduler and finally the integration point with BulkContactService.

## Tasks

- [ ] 1. Create core interfaces, types, and configuration
  - [ ] 1.1 Define HumanLikeSendJobData interface and constants
    - Create `backend/src/mail/human-like-send.types.ts`
    - Define `HUMAN_LIKE_SEND_JOB` constant, `HumanLikeSendJobData` interface, and `HumanLikeSendJobResult` interface
    - Define `RandomizationConfig` interface with all config fields (batchSizeMin/Max, delayMin/Max, breakMin/Max, jitterMin/Max, enabled)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 10.2_

  - [ ] 1.2 Implement RandomizationConfigService
    - Create `backend/src/mail/randomization-config.service.ts`
    - Load all `HUMANLIKE_SENDING_*` environment variables via NestJS ConfigService
    - Apply defaults (batch 15-25, delay 60-180s, break 45-120min, jitter 5-10s, enabled false)
    - Validate: reject if min >= max, non-numeric, negative, or zero values at startup
    - Parse `HUMANLIKE_SENDING_ENABLED` as case-insensitive boolean, default to false for unset/invalid
    - Expose `getConfig()` and `isEnabled()` methods
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 9.1, 9.2_

  - [ ]* 1.3 Write unit tests for RandomizationConfigService
    - Test valid config loading with all env vars set
    - Test default values when env vars are missing
    - Test rejection of invalid configs (min >= max, negative, zero, non-numeric)
    - Test feature flag parsing (case-insensitive true/false, missing, invalid)
    - _Requirements: 8.5, 8.6, 8.7, 8.8, 9.1, 9.2_

- [ ] 2. Implement RandomizationService (pure logic)
  - [ ] 2.1 Create RandomizationService with core random functions
    - Create `backend/src/mail/randomization.service.ts`
    - Implement `randomInt(min, max)` using `crypto.randomInt()` for cryptographically secure generation
    - Implement `applyJitter(baseValue, jitterMin, jitterMax, clampMin)` — random magnitude in [jitterMin, jitterMax], random sign, clamp to minimum
    - Implement `generateDelay(config, previousDelay)` — base delay in [delayMin, delayMax], apply jitter with clamp 30s, regenerate if within 1s of previous (max 10 attempts, fallback offset by 2s)
    - Implement `generateBatchBreak(config)` — base break in [breakMin*60, breakMax*60] seconds, apply jitter, clamp to breakMin*60
    - Implement `generateBatchSize(config, previousBatchSizes)` — random in [batchSizeMin, batchSizeMax], check anti-pattern rules (no triple repeat, no repeated subsequence in window of 5), max 10 regeneration attempts, fallback offset by ±1
    - Implement `hasRepeatedSubsequence(sequence)` helper — detect any contiguous subsequence of length >= 2 appearing more than once in a window
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 2.2 Write property test: Batch size within bounds (Property 1)
    - **Property 1: Batch size generation stays within configured bounds**
    - **Validates: Requirements 1.1, 5.2**
    - Create `backend/src/mail/randomization.service.pbt.spec.ts`
    - Use fast-check to generate arbitrary valid configs and previousBatchSizes arrays
    - Assert `batchSizeMin <= result <= batchSizeMax` for all generated values

  - [ ]* 2.3 Write property test: Delay minimum clamp (Property 2)
    - **Property 2: Inter-email delay with jitter stays in valid range**
    - **Validates: Requirements 2.1, 2.3**
    - Assert `result >= 30` for all generated delay values regardless of config/previousDelay

  - [ ]* 2.4 Write property test: Break duration clamp (Property 3)
    - **Property 3: Batch break duration with jitter is clamped to configured minimum**
    - **Validates: Requirements 3.1, 3.3, 3.4**
    - Assert `result >= breakMin * 60` for all generated break values

  - [ ]* 2.5 Write property test: Consecutive delay separation (Property 4)
    - **Property 4: No two consecutive delays are within 1 second of each other**
    - **Validates: Requirements 2.4, 4.2**
    - Generate sequences of delays and assert `|d[i] - d[i+1]| > 1` for all consecutive pairs

  - [ ]* 2.6 Write property test: No triple-repeat batch sizes (Property 5)
    - **Property 5: No three consecutive batch sizes are identical**
    - **Validates: Requirements 4.1**
    - Generate sequences of batch sizes and assert no three consecutive values are equal

  - [ ]* 2.7 Write property test: No repeated subsequence in window (Property 6)
    - **Property 6: No repeated contiguous subsequence in batch size window**
    - **Validates: Requirements 4.3**
    - Generate sequences and assert `hasRepeatedSubsequence` returns false for any window of 5

  - [ ]* 2.8 Write property test: Config validation (Property 9)
    - **Property 9: Configuration validation accepts valid configs and rejects invalid ones**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.7, 8.8**
    - Use fast-check to generate arbitrary (min, max) pairs and verify acceptance/rejection

- [ ] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement SendState persistence layer
  - [ ] 4.1 Create SendState Mongoose schema and repository
    - Create `backend/src/mail/send-state.schema.ts` with all fields: bulkJobId, userId, status (enum), totalEmails, sentCount, failedCount, currentBatch, currentEmailIndex, previousBatchSizes, emailResults array, startedAt, completedAt, cancelRequested
    - Create `backend/src/mail/send-state.repository.ts` with methods: `createOrResume`, `markEmailSent`, `markEmailFailed`, `updateBatchPosition`, `markCompleted`, `markCancelled`, `findIncomplete`, `findByBulkJobId`
    - Use `@InjectModel` pattern consistent with other repositories in the project
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 5.7, 5.8_

  - [ ]* 4.2 Write unit tests for SendStateRepository
    - Test create, update, and query operations
    - Test state transitions (pending → in_progress → completed/cancelled)
    - Test findIncomplete returns only non-completed states
    - _Requirements: 7.1, 7.2_

- [ ] 5. Extract MailSenderService from MailProcessor
  - [ ] 5.1 Create MailSenderService with shared SMTP sending logic
    - Create `backend/src/mail/mail-sender.service.ts`
    - Extract the pooled transporter creation from MailProcessor into this service
    - Implement `sendEmail(data: TemplateMailJobData): Promise<TemplateMailJobResult>` — resolves sender address, resolves attachments, sends via SMTP, stores mail result
    - Ensure existing MailProcessor delegates to MailSenderService for template email sends
    - _Requirements: 10.2, 10.3_

  - [ ]* 5.2 Write unit tests for MailSenderService
    - Test email sending with mocked SMTP transporter
    - Test attachment resolution (with/without resume URL)
    - Test failure handling and result storage
    - _Requirements: 10.3_

- [ ] 6. Implement SendingSchedulerService (orchestrator)
  - [ ] 6.1 Create SendingSchedulerService as BullMQ processor
    - Create `backend/src/mail/sending-scheduler.service.ts`
    - Extend `WorkerHost`, decorate with `@Processor(MAIL_QUEUE)` 
    - Implement `process(job: Job<HumanLikeSendJobData>)` — orchestrate the full batch loop
    - Implement batch processing: generate batch size, send emails sequentially with random delays, persist state after each send
    - Implement batch break: wait randomized break duration between batches
    - Implement cancellation check: poll `cancelRequested` from SendState after each email
    - Implement async delay using `setTimeout` wrapped in a Promise (non-blocking)
    - Cap total recipients at 500 per job
    - Handle empty queue case (mark completed immediately)
    - Handle final batch (fewer emails than batch size)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 10.4, 10.5_

  - [ ] 6.2 Implement structured logging in SendingSchedulerService
    - Log batch start: INFO with jobId, batchNumber, batchSize, timestamp
    - Log email sent: INFO with jobId, recipientEmail, delay, batchNumber, timestamp
    - Log batch complete: INFO with jobId, batchNumber, sentCount, failedCount, breakDuration
    - Log email failure: ERROR with failureReason, recipientEmail, jobId, batchNumber, timestamp
    - Log job complete: INFO with jobId, totalSent, totalFailed, totalBatches, elapsedTime
    - Use WinstonLoggerService with structured metadata consistent with existing format
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ] 6.3 Implement restart recovery logic
    - Implement `OnModuleInit` to check for incomplete SendStates on startup
    - Re-enqueue HUMAN_LIKE_SEND_JOB with `resumeFrom` index for each incomplete state
    - Implement retry logic: 5 retries × 5s interval for MongoDB unavailability
    - Mark as `manual_intervention` if all retries fail
    - Implement state persistence retry: 3 retries × 1s interval after each email send
    - Halt batch and log error if persistence retries exhausted
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 6.4 Write property test: Batch attempt completeness (Property 7)
    - **Property 7: All emails in a batch are attempted regardless of individual failures**
    - **Validates: Requirements 1.3, 5.4**
    - Create `backend/src/mail/sending-scheduler.pbt.spec.ts`
    - Mock MailSenderService with random success/failure, assert sent + failed == batchSize

  - [ ]* 6.5 Write property test: Final state tally correctness (Property 8)
    - **Property 8: Final Send_State correctly tallies sent and failed counts**
    - **Validates: Requirements 5.7**
    - Run full simulated job execution, assert sentCount + failedCount == totalEmails and status == 'completed'

  - [ ]* 6.6 Write unit tests for SendingSchedulerService
    - Test empty queue handling (immediate completion)
    - Test cancellation mid-batch
    - Test final batch with fewer emails than batch size
    - Test state persistence after each email
    - Test restart recovery with seeded state
    - _Requirements: 1.4, 1.5, 5.7, 5.8, 7.2, 7.4_

- [ ] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Integration: Wire feature flag and modify BulkContactService
  - [ ] 8.1 Modify BulkContactService.triggerSend() for feature flag
    - Inject `RandomizationConfigService` into BulkContactService
    - At the start of `triggerSend()`, check `isEnabled()`
    - When enabled: collect all recipient data (personalized subjects/bodies), enqueue a single `HUMAN_LIKE_SEND_JOB` with the full recipients array instead of per-recipient TEMPLATE_MAIL_JOBs
    - When disabled: preserve existing behavior (per-recipient TEMPLATE_MAIL_JOB with 12s stagger)
    - Re-read feature flag value at each `triggerSend()` invocation
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.1, 10.2_

  - [ ] 8.2 Register all new providers in MailModule
    - Register `RandomizationService`, `RandomizationConfigService`, `SendingSchedulerService`, `MailSenderService`, `SendStateRepository` in `mail.module.ts`
    - Register `SendState` schema with MongooseModule.forFeature
    - Export `RandomizationConfigService` for use by BulkContactModule
    - Import necessary modules in BulkContactModule (or export from MailModule)
    - _Requirements: 10.1, 10.2_

  - [ ]* 8.3 Write integration tests for the full send flow
    - Test feature flag ON: single HUMAN_LIKE_SEND_JOB enqueued with all recipients
    - Test feature flag OFF: per-recipient TEMPLATE_MAIL_JOBs enqueued with 12s stagger
    - Test feature flag change mid-batch: current batch completes with old pattern, next uses new
    - Mock SMTP and verify emails arrive in correct order
    - _Requirements: 9.3, 9.4, 9.5, 9.6, 10.1_

- [ ] 9. Add cancellation endpoint
  - [ ] 9.1 Add cancel endpoint to MailController
    - Add `POST /mail/cancel/:bulkJobId` endpoint
    - Set `cancelRequested = true` on the corresponding SendState document
    - Return confirmation response
    - _Requirements: 5.8_

  - [ ]* 9.2 Write unit test for cancellation endpoint
    - Test successful cancellation request
    - Test cancellation of non-existent bulk job (404)
    - _Requirements: 5.8_

- [ ] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design uses a single long-running BullMQ job per bulk send (HUMAN_LIKE_SEND_JOB) rather than one job per recipient
- The existing MailProcessor continues to handle MAIL_JOB and TEMPLATE_MAIL_JOB for the fixed-rate path
- `SendingSchedulerService` is a separate processor on the same queue, handling only `HUMAN_LIKE_SEND_JOB`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "2.8", "4.1"] },
    { "id": 3, "tasks": ["4.2", "5.1"] },
    { "id": 4, "tasks": ["5.2", "6.1"] },
    { "id": 5, "tasks": ["6.2", "6.3"] },
    { "id": 6, "tasks": ["6.4", "6.5", "6.6"] },
    { "id": 7, "tasks": ["8.1", "8.2", "9.1"] },
    { "id": 8, "tasks": ["8.3", "9.2"] }
  ]
}
```
