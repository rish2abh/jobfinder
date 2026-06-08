import { Controller, Get, Logger, Post, Param, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { RESUME_QUEUE } from '../file-upload/resume-job.types';
import { JOB_SCRAPE_QUEUE } from './job-scrape.types';
import { MAIL_QUEUE } from '../mail/mail-job.types';
import { MATCHING_QUEUE } from '../matching/matching.types';
import { AUTO_APPLY_QUEUE } from '../auto-apply/auto-apply.types';

export interface MonitoredJob {
  id: string;
  type: string;
  state: string;
  progress: number;
  failedReason: string | null;
  timestamp: number;
  data?: Record<string, any>;
}

@ApiTags('jobs/monitor')
@ApiBearerAuth()
@Controller('jobs/monitor')
export class JobMonitorController {
  private readonly logger = new Logger(JobMonitorController.name);

  constructor(
    @InjectQueue(RESUME_QUEUE)
    private readonly resumeQueue: Queue,
    @InjectQueue(JOB_SCRAPE_QUEUE)
    private readonly scrapeQueue: Queue,
    @InjectQueue(MAIL_QUEUE)
    private readonly mailQueue: Queue,
    @InjectQueue(MATCHING_QUEUE)
    private readonly matchingQueue: Queue,
    @InjectQueue(AUTO_APPLY_QUEUE)
    private readonly autoApplyQueue: Queue,
  ) {}

  @Get('active')
  @ApiOperation({
    summary: 'Get all active/recent jobs across all queues',
    description:
      'Returns jobs from all 5 BullMQ queues (resume-parse, job-scrape, bulk-mail, matching, auto-apply) ' +
      'in active, waiting, delayed, and failed states.',
  })
  async getActiveJobs(): Promise<{ jobs: MonitoredJob[] }> {
    const queues = [
      { queue: this.resumeQueue, type: 'resume-parse' },
      { queue: this.scrapeQueue, type: 'job-scrape' },
      { queue: this.mailQueue, type: 'bulk-mail' },
      { queue: this.matchingQueue, type: 'matching' },
      { queue: this.autoApplyQueue, type: 'auto-apply' },
    ];

    const allJobs: MonitoredJob[] = [];

    for (const { queue, type } of queues) {
      const [active, waiting, delayed, failed] = await Promise.all([
        queue.getJobs(['active'], 0, 20),
        queue.getJobs(['waiting'], 0, 20),
        queue.getJobs(['delayed'], 0, 10),
        queue.getJobs(['failed'], 0, 10),
      ]);

      const jobs = [...active, ...waiting, ...delayed, ...failed];

      for (const job of jobs) {
        if (!job) continue;
        const state = await job.getState();
        allJobs.push({
          id: String(job.id),
          type,
          state,
          progress: typeof job.progress === 'number' ? job.progress : 0,
          failedReason: job.failedReason ?? null,
          timestamp: job.timestamp,
          data: {
            userId: job.data?.userId,
          },
        });
      }
    }

    // Sort by timestamp descending (most recent first)
    allJobs.sort((a, b) => b.timestamp - a.timestamp);

    return { jobs: allJobs };
  }

  @Post('retry/:type/:jobId')
  @ApiOperation({ summary: 'Retry a failed job (resume-parse or job-scrape only)' })
  @ApiParam({ name: 'type', enum: ['resume-parse', 'job-scrape'] })
  @ApiParam({ name: 'jobId', example: '12' })
  async retryJob(
    @Param('type') type: string,
    @Param('jobId') jobId: string,
  ): Promise<{ status: string; jobId: string }> {
    if (type !== 'resume-parse' && type !== 'job-scrape') {
      throw new NotFoundException('Retry is only supported for resume-parse and job-scrape jobs');
    }

    const queue = type === 'resume-parse' ? this.resumeQueue : this.scrapeQueue;
    const job = await queue.getJob(jobId);

    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found in ${type} queue`);
    }

    const state = await job.getState();
    if (state !== 'failed') {
      return { status: 'not_failed', jobId };
    }

    await job.retry();
    this.logger.log(`Retried ${type} job ${jobId}`);

    return { status: 'retried', jobId };
  }
}
