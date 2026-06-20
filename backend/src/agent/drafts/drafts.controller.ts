import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Request } from 'express';
import { DraftRepository } from './draft.repository';
import {
  MAIL_QUEUE,
  AGENT_MAIL_JOB,
  AgentMailJobData,
  AgentMailJobResult,
} from '../../mail/mail-job.types';

@ApiTags('agent-drafts')
@ApiBearerAuth()
@Controller('agent/drafts')
export class DraftsController {
  constructor(
    private readonly draftRepo: DraftRepository,
    @InjectQueue(MAIL_QUEUE)
    private readonly mailQueue: Queue<AgentMailJobData, AgentMailJobResult>,
  ) {}

  // ── GET /agent/drafts ──────────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'List pending drafts for the current user',
  })
  @ApiResponse({ status: 200, description: 'Pending drafts list' })
  async listPending(@Req() req: Request) {
    const userId = (req.user as any)?.sub;
    return this.draftRepo.findPending(userId);
  }

  // ── PATCH /agent/drafts/:id ────────────────────────────────────────────────

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit a draft (sets status to edited)',
  })
  @ApiParam({ name: 'id' })
  async editDraft(
    @Param('id') id: string,
    @Req() req: Request,
    @Body() body: { subject?: string; body?: string },
  ) {
    const userId = (req.user as any)?.sub;
    const draft = await this.draftRepo.findById(id);
    if (!draft || draft.userId !== userId) {
      throw new NotFoundException('Draft not found');
    }

    return this.draftRepo.update(id, {
      ...(body.subject !== undefined && { subject: body.subject }),
      ...(body.body !== undefined && { body: body.body }),
      status: 'edited',
    });
  }

  // ── POST /agent/drafts/:id/approve ─────────────────────────────────────────

  @Post(':id/approve')
  @ApiOperation({
    summary: 'Approve a draft for sending',
    description:
      'Marks draft as approved and enqueues it for delivery. ' +
      'Only works if current status is "pending" or "edited".',
  })
  @ApiParam({ name: 'id' })
  async approveDraft(@Param('id') id: string, @Req() req: Request) {
    const userId = (req.user as any)?.sub;
    const draft = await this.draftRepo.findById(id);

    if (!draft || draft.userId !== userId) {
      throw new NotFoundException('Draft not found');
    }

    if (draft.status !== 'pending' && draft.status !== 'edited') {
      throw new ConflictException(
        `Cannot approve draft with status "${draft.status}". Only pending or edited drafts can be approved.`,
      );
    }

    // Enqueue first — only mark approved if the job is successfully queued
    await this.mailQueue.add(
      AGENT_MAIL_JOB,
      {
        draftId: id,
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

    await this.draftRepo.update(id, { status: 'approved' });

    return { status: 'approved', draftId: id };
  }

  // ── POST /agent/drafts/:id/reject ──────────────────────────────────────────

  @Post(':id/reject')
  @ApiOperation({
    summary: 'Reject a draft — it will not be sent',
  })
  @ApiParam({ name: 'id' })
  async rejectDraft(@Param('id') id: string, @Req() req: Request) {
    const userId = (req.user as any)?.sub;
    const draft = await this.draftRepo.findById(id);

    if (!draft || draft.userId !== userId) {
      throw new NotFoundException('Draft not found');
    }

    return this.draftRepo.update(id, { status: 'rejected' });
  }
}
