import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';
import { JobsService } from './jobs.service';
import { TriggerScrapeDto } from './dto/trigger-scrape.dto';
import type { JobSource } from './job.schema';

class UserIdParam {
  @IsMongoId()
  userId: string;
}

@ApiTags('jobs')
@Controller('jobs')
export class JobsController {
  private readonly logger = new Logger(JobsController.name);

  constructor(private readonly jobsService: JobsService) {}

  // ── POST /jobs/scrape ──────────────────────────────────────────────────────

  @Post('scrape')
  @ApiOperation({
    summary: 'Trigger a job-scraping run based on skill keywords',
    description:
      'Enqueues a BullMQ scrape job that runs Playwright scrapers against Indeed, ' +
      'Naukri, Internshala, and JSearch API. Returns { jobId } immediately. ' +
      'If fresh results (<24h) already exist for the same skills, returns { status: "cached" } instead.',
  })
  @ApiResponse({
    status: 201,
    schema: {
      oneOf: [
        {
          type: 'object',
          properties: {
            jobId:  { type: 'string' },
            status: { type: 'string', example: 'queued' },
          },
        },
        {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'cached' },
            count:  { type: 'number' },
          },
        },
      ],
    },
  })
  async triggerScrape(@Body() dto: TriggerScrapeDto) {
    const skills = dto.skills?.length
      ? dto.skills
      : await this.jobsService.getSkillsFromResume(dto.userId);

    if (skills.length === 0) {
      return { status: 'no_skills', message: 'No skills found — upload and parse your resume first.' };
    }

    return this.jobsService.triggerScrape(dto.userId, skills, {
      force:        dto.force,
      sources:      dto.sources,
      maxPerSource: dto.maxPerSource,
      companies:    dto.companies,
      keywords:     dto.keywords,
      country:      dto.country,
    });
  }

  // ── GET /jobs/scrape/status/:jobId ─────────────────────────────────────────

  @Get('scrape/status/:jobId')
  @ApiOperation({ summary: 'Poll scrape job status' })
  @ApiParam({ name: 'jobId', example: '12' })
  async getScrapeStatus(@Param('jobId') jobId: string) {
    return this.jobsService.getScrapeJobStatus(jobId);
  }

  // ── GET /jobs ──────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'List jobs matching user skill profile',
    description:
      'Returns paginated jobs filtered by skills, experience level, and source. ' +
      'Uses skills from the user\'s parsed resume if no skill query is provided. ' +
      'Sorted by published date (most recent first), falling back to scrape date.',
  })
  @ApiQuery({ name: 'userId',          required: true,  example: '665df8d2f98f48bd8f04f2a1' })
  @ApiQuery({ name: 'skills',          required: false, isArray: true, type: String })
  @ApiQuery({ name: 'source',          required: false, enum: ['indeed', 'naukri', 'internshala', 'jsearch', 'google', 'company'] })
  @ApiQuery({ name: 'experienceLevel', required: false, enum: ['any', 'auto', 'internship', 'entry', 'mid', 'senior', 'manager'] })
  @ApiQuery({ name: 'sortBy',          required: false, enum: ['postedAt', 'scrapedAt'] })
  @ApiQuery({ name: 'limit',           required: false, type: Number })
  @ApiQuery({ name: 'skip',            required: false, type: Number })
  async getJobs(
    @Query('userId')          userId:           string,
    @Query('skills')          skills?:          string | string[],
    @Query('source')          source?:          string,
    @Query('experienceLevel') experienceLevel?: string,
    @Query('sortBy')          sortBy?:          string,
    @Query('limit')           limit?:           string,
    @Query('skip')            skip?:            string,
  ) {
    const skillArr = !skills
      ? []
      : Array.isArray(skills)
        ? skills
        : skills.split(',').map((s) => s.trim()).filter(Boolean);

    return this.jobsService.getJobsForUser(userId, {
      skills:          skillArr,
      source:          source as JobSource | undefined,
      experienceLevel: experienceLevel ?? 'any',
      sortBy:          (sortBy === 'scrapedAt' ? 'scrapedAt' : 'postedAt'),
      limit:           limit ? parseInt(limit,  10) : 50,
      skip:            skip  ? parseInt(skip,   10) : 0,
    });
  }

  // ── GET /jobs/skills/:userId ───────────────────────────────────────────────

  @Get('skills/:userId')
  @ApiOperation({ summary: "Retrieve skills extracted from the user's parsed resume" })
  @ApiParam({ name: 'userId', example: '665df8d2f98f48bd8f04f2a1' })
  async getSkills(@Param('userId') userId: string) {
    const skills = await this.jobsService.getSkillsFromResume(userId);
    return { userId, skills };
  }

  // ── POST /jobs/cleanup ───────────────────────────────────────────────────────

  @Post('cleanup')
  @ApiOperation({ summary: 'Remove job records older than N days (default: 30)' })
  @ApiQuery({ name: 'days', required: false, type: Number })
  async cleanup(@Query('days') days?: string) {
    return this.jobsService.cleanupOldJobs(days ? parseInt(days, 10) : 30);
  }

  // ── POST /jobs/fix-flags ─────────────────────────────────────────────────────

  @Post('fix-flags')
  @ApiOperation({ summary: 'Clear captcha-related flags from all jobs' })
  async fixFlags() {
    return this.jobsService.clearCaptchaFlags();
  }

  // ── GET /jobs/cache/stats ─────────────────────────────────────────────────

  @Get('cache/stats')
  @ApiOperation({ summary: 'Get cache statistics — total jobs, by source, fresh count, date range' })
  async cacheStats() {
    return this.jobsService.getCacheStats();
  }

  // ── GET /jobs/cache ───────────────────────────────────────────────────────

  @Get('cache')
  @ApiOperation({ summary: 'List cached jobs (paginated, filterable by source)' })
  @ApiQuery({ name: 'source', required: false, enum: ['indeed', 'naukri', 'internshala', 'jsearch', 'google', 'company'] })
  @ApiQuery({ name: 'limit',  required: false, type: Number, description: 'Max 500' })
  @ApiQuery({ name: 'skip',   required: false, type: Number })
  async listCache(
    @Query('source') source?: string,
    @Query('limit')  limit?: string,
    @Query('skip')   skip?: string,
  ) {
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 500) : 200;
    return this.jobsService.getCacheJobs({
      source: source as JobSource | undefined,
      limit:  parsedLimit,
      skip:   skip ? parseInt(skip, 10) : 0,
    });
  }

  // ── DELETE /jobs/cache/all ────────────────────────────────────────────────

  @Delete('cache/all')
  @ApiOperation({ summary: 'Delete ALL cached job records' })
  async clearAllCache() {
    return this.jobsService.deleteAllCache();
  }

  // ── DELETE /jobs/cache/source/:source ─────────────────────────────────────

  @Delete('cache/source/:source')
  @ApiOperation({ summary: 'Delete all cached jobs for a specific source' })
  @ApiParam({ name: 'source', enum: ['indeed', 'naukri', 'internshala', 'jsearch', 'google', 'company'] })
  async clearCacheBySource(@Param('source') source: string) {
    return this.jobsService.deleteCacheBySource(source as JobSource);
  }

  // ── DELETE /jobs/cache/:id ────────────────────────────────────────────────

  @Delete('cache/:id')
  @ApiOperation({ summary: 'Delete a single cached job by its MongoDB _id' })
  @ApiParam({ name: 'id', example: '665df8d2f98f48bd8f04f2a1' })
  async deleteCacheById(@Param('id') id: string) {
    return this.jobsService.deleteCacheById(id);
  }
}
