import {
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { Request } from 'express';
import { randomUUID } from 'crypto';
import { AgentJournalRepository } from './journal/agent-journal.repository';
import {
  AGENT_RUN_QUEUE,
  AGENT_RUN_JOB,
  AgentRunJobData,
  AgentRunJobResult,
  AgentRunStatus,
} from './agent.types';

@ApiTags('agent')
@ApiBearerAuth()
@Controller('agent')
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(
    @InjectQueue(AGENT_RUN_QUEUE)
    private readonly agentQueue: Queue<AgentRunJobData, AgentRunJobResult>,
    private readonly journalRepo: AgentJournalRepository,
  ) {}

  // ── POST /agent/chat ──────────────────────────────────────────────────────

  @Post('chat')
  @ApiOperation({
    summary: 'Send a message to the AI agent',
    description:
      'Enqueues an agent run processed by the Gemini orchestrator via BullMQ. ' +
      'Returns a jobId for polling status. The agent may call tools (job scraping, ' +
      'matching, auto-apply, email drafting) and returns a final text response.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['message'],
      properties: {
        message: {
          type: 'string',
          example: 'Find React jobs in Bangalore and show me the top matches',
        },
        conversationId: {
          type: 'string',
          description: 'Optional conversation ID for multi-turn context',
        },
      },
    },
  })
  @ApiResponse({
    status: 202,
    description: 'Agent run enqueued',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        conversationId: { type: 'string' },
        status: { type: 'string', example: 'queued' },
      },
    },
  })
  async chat(
    @Req() req: Request,
    @Body() body: { message: string; conversationId?: string },
  ) {
    const userId = (req.user as any)?.sub ?? (req.user as any)?._id?.toString();
    const conversationId = body.conversationId ?? randomUUID();

    // Check for existing active/waiting job for the same userId
    const existingJob = await this.findActiveJobForUser(userId);
    if (existingJob) {
      this.logger.log(
        `Agent run rejected — duplicate for user: ${userId}, existing jobId: ${existingJob}`,
      );
      return {
        jobId: existingJob,
        conversationId,
        status: 'already_running',
      };
    }

    this.logger.log(`Agent chat queued — user: ${userId}, conv: ${conversationId}`);

    const job = await this.agentQueue.add(AGENT_RUN_JOB, {
      userId,
      message: body.message,
      conversationId,
    }, {
      attempts: 1,
      removeOnComplete: { age: 60 * 60 * 24, count: 200 },
      removeOnFail: { age: 60 * 60 * 24 * 7 },
    });

    return {
      jobId: String(job.id),
      conversationId,
      status: 'queued',
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Scan the agent queue for an active or waiting job belonging to the same userId.
   * Returns the jobId if found, null otherwise.
   */
  private async findActiveJobForUser(userId: string): Promise<string | null> {
    const [active, waiting, delayed] = await Promise.all([
      this.agentQueue.getActive(0, 50),
      this.agentQueue.getWaiting(0, 50),
      this.agentQueue.getDelayed(0, 50),
    ]);

    const allJobs = [...active, ...waiting, ...delayed];

    for (const job of allJobs) {
      if (job.data?.userId === userId) {
        return String(job.id);
      }
    }

    return null;
  }

  // ── GET /agent/chat/status/:jobId ─────────────────────────────────────────

  @Get('chat/status/:jobId')
  @ApiOperation({
    summary: 'Poll agent run status',
    description: 'Returns the current state, progress, and result of an agent run.',
  })
  @ApiParam({ name: 'jobId', description: 'BullMQ job ID from POST /agent/chat' })
  @ApiResponse({ status: 200, description: 'Agent run status' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async getChatStatus(@Param('jobId') jobId: string): Promise<AgentRunStatus> {
    const job: Job<AgentRunJobData, AgentRunJobResult> | undefined =
      await this.agentQueue.getJob(jobId);

    if (!job) {
      throw new NotFoundException(`Agent job ${jobId} not found`);
    }

    const state = await job.getState();

    return {
      jobId: String(job.id),
      state,
      progress: typeof job.progress === 'number' ? job.progress : 0,
      result: job.returnvalue ?? null,
      failedReason: job.failedReason ?? null,
    };
  }

  // ── GET /agent/journal ────────────────────────────────────────────────────

  @Get('journal')
  @ApiOperation({
    summary: 'Get the agent action journal',
    description:
      'Returns a paginated list of all agent interactions for this user, ' +
      'including tool calls, results, token usage, and timestamps.',
  })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Journal entries' })
  async getJournal(
    @Req() req: Request,
    @Query('skip') skip?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = (req.user as any)?.sub ?? (req.user as any)?._id?.toString();
    return this.journalRepo.findByUser(userId, {
      skip: skip ? parseInt(skip, 10) : 0,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }

  // ── GET /agent/journal/:conversationId ────────────────────────────────────

  @Get('journal/:conversationId')
  @ApiOperation({ summary: 'Get journal entries for a specific conversation' })
  @ApiParam({ name: 'conversationId' })
  async getConversationJournal(
    @Req() req: Request,
    @Param('conversationId') conversationId: string,
  ) {
    const userId = (req.user as any)?.sub ?? (req.user as any)?._id?.toString();
    return this.journalRepo.findByConversation(userId, conversationId);
  }
}
