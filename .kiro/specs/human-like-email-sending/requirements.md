# Requirements Document

## Introduction

This feature enhances the existing email automation system by replacing the fixed-rate sending pattern (currently 5 emails/min via BullMQ limiter with 12s stagger delays) with a human-like randomized sending pattern. The goal is to improve email deliverability and avoid spam detection by simulating natural human sending behavior through randomized batch sizes, variable inter-email delays, and unpredictable break periods between batches. The system must integrate seamlessly with the existing NestJS/BullMQ/MongoDB/Redis infrastructure.

## Glossary

- **Sending_Scheduler**: The service responsible for orchestrating the randomized email sending pattern, determining batch sizes, delays, and break durations
- **Batch**: A group of emails sent together in one cycle before a longer pause occurs
- **Inter_Email_Delay**: The randomized wait time between sending individual emails within a batch
- **Batch_Break**: The randomized pause duration between consecutive batches
- **Jitter**: A small random offset (±5-10 seconds) added to computed delays to prevent detectable timing patterns
- **Send_Queue**: The BullMQ queue that holds pending email jobs for processing
- **Send_State**: A persistent record of the current sending progress including batch position, emails sent, and queue cursor, stored in MongoDB
- **Randomization_Config**: The configurable parameters that define the bounds for batch sizes, delays, and break durations
- **Feature_Flag**: A toggle that enables or disables the randomized sending pattern, falling back to the existing fixed-rate behavior when disabled

## Requirements

### Requirement 1: Batch-Based Email Sending

**User Story:** As a user sending bulk emails, I want my emails sent in random-sized batches, so that the sending pattern mimics natural human behavior and avoids triggering spam filters.

#### Acceptance Criteria

1. WHEN a bulk send operation is triggered, THE Sending_Scheduler SHALL fetch pending emails from the Send_Queue and organize them into batches of random size between the configured minimum (default 15) and maximum (default 25) values using a uniform random distribution, and SHALL reject the configuration if the minimum is greater than or equal to the maximum
2. WHEN all emails in the current batch have been attempted (sent or failed), THE Sending_Scheduler SHALL generate a new random batch size for the next cycle independent of previous batch sizes
3. THE Sending_Scheduler SHALL process batches sequentially until the Send_Queue is empty, continuing to the next email in the batch if an individual email send fails
4. WHEN fewer pending emails remain than the generated batch size, THE Sending_Scheduler SHALL send all remaining emails as the final batch without waiting for a full batch
5. IF a bulk send operation is triggered and the Send_Queue contains no pending emails for the specified bulk job, THEN THE Sending_Scheduler SHALL mark the bulk job as completed immediately without generating a batch

### Requirement 2: Randomized Inter-Email Delay

**User Story:** As a user sending bulk emails, I want random delays between each email send, so that the timing pattern appears natural and does not trigger rate-based spam detection.

#### Acceptance Criteria

1. WHEN sending each email within a batch, THE Sending_Scheduler SHALL wait a random delay between the configured minimum (default 60 seconds) and maximum (default 180 seconds) before sending the next email, where the first email in a batch is sent immediately without a preceding delay
2. THE Sending_Scheduler SHALL generate a new random delay value for each email independently using a uniform distribution over the configured range
3. WHEN a base delay is computed, THE Sending_Scheduler SHALL add a random jitter by selecting a magnitude uniformly between 5 and 10 seconds and applying it as either positive or negative (randomly chosen), clamping the final delay to a minimum of 30 seconds
4. THE Sending_Scheduler SHALL ensure no two consecutive inter-email delays are within 1 second of each other; IF the generated delay is within 1 second of the previous delay, THEN THE Sending_Scheduler SHALL regenerate the delay value

### Requirement 3: Randomized Batch Break

**User Story:** As a user sending bulk emails, I want random pauses between batches, so that the overall sending cadence mimics human work-break patterns.

#### Acceptance Criteria

1. WHEN a batch is completed and pending emails remain in the Send_Queue, THE Sending_Scheduler SHALL pause for a uniformly random duration between the configured minimum (default 45 minutes) and maximum (default 120 minutes) before starting the next batch
2. THE Sending_Scheduler SHALL generate a new random break duration for each batch transition independently, with no correlation to previous break durations
3. WHEN a break duration is computed, THE Sending_Scheduler SHALL add a random jitter by selecting a magnitude uniformly between 5 and 10 seconds and randomly applying it as positive or negative to the base break value
4. IF the computed break duration after jitter falls below the configured minimum, THEN THE Sending_Scheduler SHALL clamp the value to the configured minimum
5. WHEN a batch is completed and no pending emails remain in the Send_Queue, THE Sending_Scheduler SHALL skip the batch break and proceed directly to marking the bulk job as completed

### Requirement 4: Anti-Pattern Detection Avoidance

**User Story:** As a user sending bulk emails, I want the system to avoid any detectable repeating patterns, so that spam filters cannot identify automated behavior.

#### Acceptance Criteria

1. IF a newly generated batch size equals the batch size of the previous 2 consecutive batches, THEN THE Sending_Scheduler SHALL discard the value and regenerate a new random batch size until a different value is produced, within a maximum of 10 regeneration attempts
2. THE Sending_Scheduler SHALL ensure no two consecutive inter-email delays within the same batch are identical when compared as whole-second integer values
3. THE Sending_Scheduler SHALL ensure no subsequence of 2 or more batch sizes appears more than once within a sliding window of the most recent 5 batches, comparing batch sizes as integer values
4. WHEN generating random values for delays and batch sizes, THE Sending_Scheduler SHALL use cryptographically secure random number generation (Node.js crypto module)
5. IF the Sending_Scheduler exhausts the maximum 10 regeneration attempts without producing a non-repeating batch size, THEN THE Sending_Scheduler SHALL use the last generated value offset by 1 (incrementing or decrementing to stay within configured bounds)

### Requirement 5: Execution Flow Orchestration

**User Story:** As a user triggering a bulk send, I want the system to automatically manage the full send lifecycle, so that I do not need to manually intervene during the process.

#### Acceptance Criteria

1. WHEN a bulk send is triggered, THE Sending_Scheduler SHALL fetch all pending emails from the Send_Queue for the specified bulk job, up to a maximum of 500 emails per job
2. WHEN pending emails are fetched, THE Sending_Scheduler SHALL generate a random batch size within configured bounds (default 15 to 25) as defined in the Randomization_Config
3. WHEN a batch size is determined, THE Sending_Scheduler SHALL send each email in the batch sequentially, waiting the randomized inter-email delay between each send as defined in Requirement 2
4. IF an individual email send fails during batch processing, THEN THE Sending_Scheduler SHALL record the failure for that recipient, skip the failed email, and continue sending the remaining emails in the batch
5. WHEN all emails in a batch have been sent or skipped, THE Sending_Scheduler SHALL pause for a randomized batch break duration as defined in Requirement 3
6. WHEN a batch break completes, THE Sending_Scheduler SHALL generate a new random batch size and repeat the send cycle until the Send_Queue contains no unsent emails for the bulk job
7. WHEN the Send_Queue contains no unsent emails for the bulk job, THE Sending_Scheduler SHALL mark the bulk job status as "completed" in the Send_State, including a count of successfully sent and failed emails
8. IF the user requests cancellation of a running bulk job, THEN THE Sending_Scheduler SHALL stop processing after the current email finishes sending, mark the job status as "cancelled" in the Send_State, and leave remaining unsent emails in the Send_Queue

### Requirement 6: Sending Activity Logging

**User Story:** As a system administrator, I want detailed logs of sending activity, so that I can monitor system behavior and debug delivery issues.

#### Acceptance Criteria

1. WHEN a new batch begins, THE Sending_Scheduler SHALL log at INFO level the bulk job identifier, batch number, generated batch size, and timestamp using the Winston logger
2. WHEN an email is successfully sent via SMTP, THE Sending_Scheduler SHALL log at INFO level the bulk job identifier, recipient email, computed delay (in seconds) applied before the send, batch number, and timestamp
3. WHEN a batch completes, THE Sending_Scheduler SHALL log at INFO level the bulk job identifier, batch number, count of emails successfully sent, count of emails failed in the batch, and the computed break duration (in seconds) before the next batch
4. IF an email send fails, THEN THE Sending_Scheduler SHALL log at ERROR level the failure reason, recipient email, bulk job identifier, batch number, and timestamp
5. THE Sending_Scheduler SHALL use the existing WinstonLoggerService with structured metadata fields (jobId, context, and additional key-value pairs) consistent with the existing logger format
6. WHEN all batches for a bulk job are complete, THE Sending_Scheduler SHALL log at INFO level the bulk job identifier, total emails sent successfully, total emails failed, total batches processed, and total elapsed time in seconds

### Requirement 7: Restart Safety and State Persistence

**User Story:** As a user, I want the system to resume sending from where it left off after a restart or crash, so that no emails are duplicated or lost.

#### Acceptance Criteria

1. WHEN an email is successfully sent, THE Sending_Scheduler SHALL persist the updated Send_State (including the email's sent status and current batch position) to MongoDB before proceeding to send the next email
2. WHEN the system restarts, THE Sending_Scheduler SHALL load the most recent Send_State for each incomplete bulk job from MongoDB and resume processing from the first unsent email in that job's queue within 10 seconds of startup
3. IF the Send_State persistence to MongoDB fails after a successful email send, THEN THE Sending_Scheduler SHALL retry the persistence up to 3 times with 1-second intervals before halting the batch and logging the failure
4. IF the system crashes mid-batch, THEN THE Sending_Scheduler SHALL resume from the first unsent email in the interrupted batch upon restart, determined by the last successfully persisted Send_State
5. IF MongoDB is unavailable when the system restarts, THEN THE Sending_Scheduler SHALL retry loading the Send_State up to 5 times with 5-second intervals before marking the bulk job as requiring manual intervention

### Requirement 8: Configurable Randomization Parameters

**User Story:** As a system administrator, I want to configure the randomization bounds, so that I can tune the sending behavior without code changes.

#### Acceptance Criteria

1. THE Randomization_Config SHALL support configurable minimum and maximum batch size as positive integers with a minimum value of 1 and a maximum value of 1000 (defaults: 15 and 25)
2. THE Randomization_Config SHALL support configurable minimum and maximum inter-email delay in seconds as positive integers with a minimum value of 1 and a maximum value of 3600 (defaults: 60 and 180)
3. THE Randomization_Config SHALL support configurable minimum and maximum batch break duration in minutes as positive integers with a minimum value of 1 and a maximum value of 1440 (defaults: 45 and 120)
4. THE Randomization_Config SHALL support configurable minimum and maximum jitter offset in seconds as positive integers with a minimum value of 1 and a maximum value of 60 (defaults: 5 and 10)
5. THE Randomization_Config SHALL be loadable from environment variables via the NestJS ConfigService using the prefix HUMANLIKE_SENDING_ followed by the parameter name in uppercase (e.g., HUMANLIKE_SENDING_BATCH_SIZE_MIN, HUMANLIKE_SENDING_BATCH_SIZE_MAX, HUMANLIKE_SENDING_DELAY_MIN, HUMANLIKE_SENDING_DELAY_MAX, HUMANLIKE_SENDING_BREAK_MIN, HUMANLIKE_SENDING_BREAK_MAX, HUMANLIKE_SENDING_JITTER_MIN, HUMANLIKE_SENDING_JITTER_MAX)
6. WHEN configuration values are missing, THE Sending_Scheduler SHALL use the documented default values
7. IF a configured minimum value exceeds its corresponding maximum value, THEN THE Randomization_Config SHALL reject the configuration at application startup and log an error message indicating which parameter pair is invalid
8. IF a configured value is non-numeric, negative, or zero, THEN THE Randomization_Config SHALL reject the configuration at application startup and log an error message indicating which parameter is invalid

### Requirement 9: Feature Flag for Randomization

**User Story:** As a system administrator, I want a feature flag to enable or disable the randomized sending pattern, so that I can switch between human-like and fixed-rate sending without redeploying.

#### Acceptance Criteria

1. THE Feature_Flag SHALL be configurable via an environment variable named HUMANLIKE_SENDING_ENABLED that accepts the values "true" or "false" (case-insensitive)
2. IF the HUMANLIKE_SENDING_ENABLED environment variable is not set or contains a value other than "true" or "false", THEN THE Sending_Scheduler SHALL default to the fixed-rate sending pattern (disabled state)
3. WHILE the Feature_Flag is disabled, THE Sending_Scheduler SHALL use the existing fixed-rate sending pattern (12-second stagger delay per recipient via BullMQ)
4. WHILE the Feature_Flag is enabled, THE Sending_Scheduler SHALL use the randomized batch-based sending pattern as defined in Requirements 1 through 5
5. THE Sending_Scheduler SHALL re-read the Feature_Flag value from the environment at the start of each batch cycle (or before each new bulk send job when in fixed-rate mode) and apply the current value to the next processing cycle
6. IF the Feature_Flag value changes while a batch is in progress, THEN THE Sending_Scheduler SHALL complete the current batch using the previously active sending pattern and apply the new pattern starting from the next batch or job cycle

### Requirement 10: Integration with Existing Queue System

**User Story:** As a developer, I want the human-like sending pattern to integrate with the existing BullMQ infrastructure, so that the system remains maintainable and consistent.

#### Acceptance Criteria

1. THE Sending_Scheduler SHALL use the existing bulk-mail BullMQ queue (MAIL_QUEUE constant) for processing email jobs
2. THE Sending_Scheduler SHALL be compatible with the existing TemplateMailJobData and BulkMailJobData job payload interfaces without modifying their structure
3. THE Sending_Scheduler SHALL preserve all existing retry logic (3 attempts with exponential backoff at 5000ms base delay) for individual email send failures
4. THE Sending_Scheduler SHALL use async processing (Promise-based delays via setTimeout wrapped in a Promise) and SHALL NOT block the NestJS event loop during delays
5. WHEN the randomized sending pattern is active, THE Sending_Scheduler SHALL override the existing per-recipient delay stagger (12s) with the randomized delay pattern, while preserving the queue's concurrency setting of 1 worker
