import {
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
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { MatchingService } from './matching.service';

@ApiTags('matching')
@ApiBearerAuth()
@Controller('matching')
export class MatchingController {
  private readonly logger = new Logger(MatchingController.name);

  constructor(private readonly matchingService: MatchingService) {}

  // ── GET /matching/scores/:userId ───────────────────────────────────────────

  @Get('scores/:userId')
  @ApiOperation({
    summary: 'Get cached match scores for a user',
    description:
      'Returns paginated match scores sorted by finalScore descending. ' +
      'Scores are pre-computed and cached in MongoDB.',
  })
  @ApiParam({ name: 'userId', description: 'The user ID to get scores for' })
  @ApiQuery({ name: 'skip', required: false, type: Number, description: 'Number of scores to skip (default: 0)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max scores to return (default: 50)' })
  @ApiResponse({
    status: 200,
    description: 'Match scores returned successfully',
    schema: {
      type: 'object',
      properties: {
        scores: { type: 'array', items: { type: 'object' } },
        total: { type: 'number' },
        skip: { type: 'number' },
        limit: { type: 'number' },
      },
    },
  })
  async getScores(
    @Req() req: Request,
    @Param('userId') userId: string,
    @Query('skip') skip?: string,
    @Query('limit') limit?: string,
  ) {
    return this.matchingService.getScores(userId, {
      skip: skip ? parseInt(skip, 10) : 0,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }

  // ── POST /matching/recompute/:userId ───────────────────────────────────────

  @Post('recompute/:userId')
  @ApiOperation({
    summary: 'Force recompute all match scores for a user',
    description:
      'Invalidates all cached scores and enqueues a recompute job. ' +
      'Returns the job ID for status polling.',
  })
  @ApiParam({ name: 'userId', description: 'The user ID to recompute scores for' })
  @ApiResponse({
    status: 201,
    description: 'Recompute job enqueued',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        status: { type: 'string', example: 'queued' },
        invalidated: { type: 'number' },
      },
    },
  })
  async recompute(@Req() req: Request, @Param('userId') userId: string) {
    return this.matchingService.recompute(userId);
  }

  // ── GET /matching/status/:jobId ────────────────────────────────────────────

  @Get('status/:jobId')
  @ApiOperation({
    summary: 'Poll matching job status',
    description:
      'Returns the current state and progress of a matching queue job.',
  })
  @ApiParam({ name: 'jobId', description: 'BullMQ job ID to check status for' })
  @ApiResponse({
    status: 200,
    description: 'Job status returned',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        state: { type: 'string', enum: ['waiting', 'active', 'completed', 'failed', 'delayed'] },
        progress: { type: 'number' },
        result: { type: 'object', nullable: true },
        failedReason: { type: 'string', nullable: true },
        attemptsMade: { type: 'number' },
      },
    },
  })
  async getStatus(@Req() req: Request, @Param('jobId') jobId: string) {
    const status = await this.matchingService.getJobStatus(jobId);

    if (!status) {
      throw new NotFoundException(`Matching job ${jobId} not found`);
    }

    return status;
  }
}
