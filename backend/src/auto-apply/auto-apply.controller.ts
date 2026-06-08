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
import { Request } from 'express';
import { AutoApplyService } from './auto-apply.service';
import { TriggerApplyDto } from './dto/trigger-apply.dto';
import { BatchApplyDto } from './dto/batch-apply.dto';
import { ApplicationStatus } from './application.schema';

@ApiTags('applications')
@ApiBearerAuth()
@Controller('applications')
export class AutoApplyController {
  private readonly logger = new Logger(AutoApplyController.name);

  constructor(private readonly autoApplyService: AutoApplyService) {}

  // ── POST /applications/apply ───────────────────────────────────────────────

  @Post('apply')
  @ApiOperation({ summary: 'Auto-apply to a single job listing' })
  @ApiBody({ type: TriggerApplyDto })
  @ApiResponse({ status: 201, description: 'Auto-apply job enqueued' })
  @ApiResponse({ status: 400, description: 'Job has no apply URL or already applied' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async applySingle(@Req() req: Request, @Body() dto: TriggerApplyDto) {
    const userId = (req as any).user?.sub;
    return this.autoApplyService.applySingle(userId, dto.jobId);
  }

  // ── POST /applications/batch-apply ─────────────────────────────────────────

  @Post('batch-apply')
  @ApiOperation({ summary: 'Auto-apply to up to 50 job listings' })
  @ApiBody({ type: BatchApplyDto })
  @ApiResponse({ status: 201, description: 'Batch auto-apply jobs enqueued' })
  @ApiResponse({ status: 400, description: 'Validation error (max 50 jobs)' })
  async applyBatch(@Req() req: Request, @Body() dto: BatchApplyDto) {
    const userId = (req as any).user?.sub;
    return this.autoApplyService.applyBatch(userId, dto.jobIds);
  }

  // ── GET /applications/status/:jobId ────────────────────────────────────────

  @Get('status/:jobId')
  @ApiOperation({ summary: 'Poll auto-apply job status' })
  @ApiParam({ name: 'jobId', description: 'BullMQ job ID' })
  @ApiResponse({ status: 200, description: 'Job status returned' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async getStatus(@Param('jobId') jobId: string) {
    const status = await this.autoApplyService.getJobStatus(jobId);
    if (!status) throw new NotFoundException(`Auto-apply job ${jobId} not found`);
    return status;
  }

  // ── GET /applications/list/:userId ─────────────────────────────────────────

  @Get('list/:userId')
  @ApiOperation({ summary: 'List tracked applications for a user' })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'applied', 'failed', 'requires_manual_action'] })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Applications list returned' })
  async getApplications(
    @Param('userId') userId: string,
    @Query('status') status?: ApplicationStatus,
    @Query('skip') skip?: string,
    @Query('limit') limit?: string,
  ) {
    return this.autoApplyService.getApplications(userId, {
      status,
      skip: skip ? parseInt(skip, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  // ── GET /applications/stats/:userId ────────────────────────────────────────

  @Get('stats/:userId')
  @ApiOperation({ summary: 'Get application statistics for a user' })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'Application statistics returned' })
  async getStats(@Param('userId') userId: string) {
    return this.autoApplyService.getStats(userId);
  }
}
