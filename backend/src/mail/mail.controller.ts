import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseFilePipeBuilder,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { SendBulkMailDto } from './dto/send-bulk-mail.dto';
import { MailService } from './mail.service';

@ApiTags('mail')
@Controller('mail')
export class MailController {
  constructor(private readonly mailService: MailService) {}

  // ── POST /mail/bulk ─────────────────────────────────────────────────────

  @Post('bulk')
  @ApiOperation({
    summary: 'Queue a bulk email job',
    description:
      'Enqueues a bulk mail job processed asynchronously via BullMQ. ' +
      'Returns a jobId immediately. Poll GET /mail/bulk/status/:jobId for results.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['subject', 'context', 'mailIds'],
      properties: {
        subject: { type: 'string', example: 'Application for Software Developer Role' },
        context: {
          type: 'string',
          example: 'Hello, please find my resume attached for your consideration.',
        },
        mailIds: {
          type: 'array',
          items: { type: 'string', format: 'email' },
          example: ['hr@example.com', 'recruiter@example.com'],
        },
        userId: {
          type: 'string',
          description: 'Use this when the resume should be loaded from the existing user profile.',
          example: '665df8d2f98f48bd8f04f2a1',
        },
        resume: {
          type: 'string',
          format: 'binary',
          description: 'Optional when userId is provided.',
        },
        from: {
          type: 'string',
          description: 'Optional custom sender address.',
        },
        fromTtlSeconds: {
          type: 'string',
          description: 'TTL for the provided from address in seconds.',
        },
      },
    },
  })
  @ApiResponse({
    status: 202,
    description: 'Job successfully enqueued',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', example: '42' },
        status: { type: 'string', example: 'queued' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('resume', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  async sendBulkMail(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: 'pdf' })
        .addMaxSizeValidator({ maxSize: 15 * 1024 * 1024 })
        .build({ errorHttpStatusCode: HttpStatus.BAD_REQUEST, fileIsRequired: false }),
    )
    resume: Express.Multer.File,
    @Body() body: SendBulkMailDto,
  ) {
    if (!resume && !body.userId) {
      throw new BadRequestException('Either resume PDF file or userId is required');
    }

    return this.mailService.enqueueBulkMail(body, resume);
  }

  // ── GET /mail/bulk/status/:jobId ────────────────────────────────────────

  @Get('bulk/status/:jobId')
  @ApiOperation({
    summary: 'Get the status of a queued bulk mail job',
    description:
      'Returns the current state (waiting, active, completed, failed), ' +
      'result, and any failure reason for a given job.',
  })
  @ApiParam({ name: 'jobId', example: '42' })
  @ApiResponse({
    status: 200,
    description: 'Job status',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        state: { type: 'string', enum: ['waiting', 'active', 'completed', 'failed', 'delayed', 'paused'] },
        progress: { type: 'number' },
        result: {
          type: 'object',
          nullable: true,
          properties: {
            message: { type: 'string' },
            sent: { type: 'array', items: { type: 'string' } },
            failed: { type: 'array', items: { type: 'string' } },
            sentCount: { type: 'number' },
            failedCount: { type: 'number' },
          },
        },
        failedReason: { type: 'string', nullable: true },
        attemptsMade: { type: 'number' },
        timestamp: { type: 'number' },
      },
    },
  })
  async getJobStatus(@Param('jobId') jobId: string) {
    return this.mailService.getJobStatus(jobId);
  }

  // ── GET /mail/history/:userId ────────────────────────────────────────────

  @Get('history/:userId')
  @ApiOperation({
    summary: 'Get all bulk mail jobs for a user',
    description: 'Returns all past and in-progress mail jobs for a given userId, sorted newest first.',
  })
  @ApiParam({ name: 'userId', example: '665df8d2f98f48bd8f04f2a1' })
  @ApiResponse({ status: 200, description: 'List of mail jobs for the user' })
  async getHistory(@Param('userId') userId: string) {
    return this.mailService.getJobsForUser(userId);
  }

  // ── GET /mail/stats/:userId ──────────────────────────────────────────────

  @Get('stats/:userId')
  @ApiOperation({
    summary: 'Get aggregate mail stats for a user',
    description: 'Returns total sent, failed, pending counts across all bulk mail jobs.',
  })
  @ApiParam({ name: 'userId', example: '665df8d2f98f48bd8f04f2a1' })
  @ApiResponse({ status: 200, description: 'Aggregate mail stats' })
  async getStats(@Param('userId') userId: string) {
    return this.mailService.getStatsForUser(userId);
  }
}
