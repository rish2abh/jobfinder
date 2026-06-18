import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseFilePipeBuilder,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Request } from 'express';
import { BulkContactService } from './bulk-contact.service';
import { GroupContactsDto } from './dto/group-contacts.dto';
import { GenerateTemplatesDto } from './dto/generate-templates.dto';
import { EditTemplateDto } from './dto/edit-template.dto';
import { TriggerBulkSendDto } from './dto/trigger-bulk-send.dto';

@ApiTags('contacts')
@ApiBearerAuth()
@Controller('contacts')
export class BulkContactController {
  constructor(private readonly bulkContactService: BulkContactService) {}

  // ── GET /contacts ────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'Get all uploaded contacts for the authenticated user',
    description:
      'Returns all contacts uploaded by the user, sorted by upload date (newest first). ' +
      'Each contact includes name, email, title, company, source file, and upload timestamp.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of contacts',
  })
  async getContacts(@Req() req: Request) {
    const userId = (req.user as any).sub ?? (req.user as any)._id?.toString();
    return this.bulkContactService.getContacts(userId);
  }

  // ── POST /contacts/upload ───────────────────────────────────────────────

  @Post('upload')
  @ApiOperation({
    summary: 'Upload a contact file (CSV/PDF/DOCX)',
    description:
      'Upload a file containing contacts. Supported formats: CSV, PDF, DOCX. ' +
      'Maximum file size: 10MB. Returns a validation report with stored and skipped counts.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Contact file (CSV, PDF, or DOCX)',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'File uploaded and parsed successfully',
    schema: {
      type: 'object',
      properties: {
        totalParsed: { type: 'number' },
        storedCount: { type: 'number' },
        skippedCount: { type: 'number' },
        duplicateCount: { type: 'number' },
        skipped: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              row: { type: 'number' },
              reason: { type: 'string' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid file format or size exceeded',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    }),
  )
  async uploadContacts(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: 10 * 1024 * 1024 })
        .build({
          errorHttpStatusCode: HttpStatus.BAD_REQUEST,
          fileIsRequired: true,
        }),
    )
    file: Express.Multer.File,
    @Req() req: Request,
  ) {
    const userId = (req.user as any).sub ?? (req.user as any)._id?.toString();
    return this.bulkContactService.uploadAndParse(userId, file);
  }

  // ── POST /contacts/group ────────────────────────────────────────────────

  @Post('group')
  @ApiOperation({
    summary: 'Group contacts by title or company',
    description:
      "Groups the authenticated user's uploaded contacts by the specified field (title or company). " +
      'Returns the created groups with their contact IDs.',
  })
  @ApiResponse({
    status: 201,
    description: 'Contacts grouped successfully',
  })
  @ApiResponse({ status: 400, description: 'No contacts found for user' })
  async groupContacts(@Req() req: Request, @Body() dto: GroupContactsDto) {
    const userId = (req.user as any).sub ?? (req.user as any)._id?.toString();
    return this.bulkContactService.groupContacts(userId, dto.groupBy, dto.contactIds);
  }

  // ── GET /contacts/groups ────────────────────────────────────────────────

  @Get('groups')
  @ApiOperation({
    summary: 'Get grouped contacts for the authenticated user',
    description: 'Returns all contact groups for the authenticated user.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of contact groups',
  })
  async getGroups(@Req() req: Request) {
    const userId = (req.user as any).sub ?? (req.user as any)._id?.toString();
    return this.bulkContactService.getGroups(userId);
  }

  // ── POST /contacts/generate-templates ───────────────────────────────────

  @Post('generate-templates')
  @ApiOperation({
    summary: 'Generate AI email templates per group',
    description:
      'Generates personalized email templates for specified groups using AI (Groq primary, Ollama fallback). ' +
      'Returns cached templates if already generated. Falls back to manual input on AI failure.',
  })
  @ApiResponse({
    status: 201,
    description: 'Templates generated successfully',
  })
  async generateTemplates(
    @Req() req: Request,
    @Body() dto: GenerateTemplatesDto,
  ) {
    const userId = (req.user as any).sub ?? (req.user as any)._id?.toString();
    return this.bulkContactService.generateTemplates(
      userId,
      dto.groupIds,
      dto.userPrompt,
    );
  }

  // ── GET /contacts/templates ───────────────────────────────────────────────

  @Get('templates')
  @ApiOperation({
    summary: 'Get all saved email templates for the authenticated user',
    description:
      'Returns all email templates (AI-generated and manual) stored for this user. ' +
      'Useful for reusing previously created templates.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of email templates',
  })
  async getTemplates(@Req() req: Request) {
    const userId = (req.user as any).sub ?? (req.user as any)._id?.toString();
    return this.bulkContactService.getTemplates(userId);
  }

  // ── PATCH /contacts/templates/:groupId ──────────────────────────────────

  @Patch('templates/:groupId')
  @ApiOperation({
    summary: 'Edit a template before sending',
    description:
      'Manually edit/update the email template for a specific contact group. ' +
      'Use this to review and adjust AI-generated templates before triggering send.',
  })
  @ApiParam({
    name: 'groupId',
    description: 'Contact group ID',
    example: '665df8d2f98f48bd8f04f2a1',
  })
  @ApiResponse({ status: 200, description: 'Template updated successfully' })
  @ApiResponse({ status: 404, description: 'Group not found' })
  async editTemplate(
    @Req() req: Request,
    @Param('groupId') groupId: string,
    @Body() dto: EditTemplateDto,
  ) {
    const userId = (req.user as any).sub ?? (req.user as any)._id?.toString();
    return this.bulkContactService.editTemplate(
      userId,
      groupId,
      dto.subject,
      dto.body,
    );
  }

  // ── POST /contacts/send ─────────────────────────────────────────────────

  @Post('send')
  @ApiOperation({
    summary: 'Trigger bulk email send',
    description:
      'Enqueues personalized emails for all recipients in the specified groups. ' +
      'Rate limited to 5 emails per minute. Returns a bulkJobId for status polling.',
  })
  @ApiResponse({
    status: 201,
    description: 'Bulk send enqueued',
    schema: {
      type: 'object',
      properties: {
        bulkJobId: { type: 'string' },
        totalRecipients: { type: 'number' },
        status: { type: 'string', example: 'queued' },
      },
    },
  })
  async triggerSend(@Req() req: Request, @Body() dto: TriggerBulkSendDto) {
    const userId = (req.user as any).sub ?? (req.user as any)._id?.toString();
    return this.bulkContactService.triggerSend(
      userId,
      dto.groupIds,
      dto.from,
      dto.resumeUrl,
      dto.contactIds,
    );
  }

  // ── GET /contacts/send/status/:jobId ────────────────────────────────────

  @Get('send/status/:jobId')
  @ApiOperation({
    summary: 'Poll bulk send status',
    description:
      'Returns the current status of a bulk send job including total, completed, failed, active, and waiting counts.',
  })
  @ApiParam({
    name: 'jobId',
    description: 'Bulk job ID returned from POST /contacts/send',
    example: '665df8d2f98f48bd8f04f2a1',
  })
  @ApiResponse({
    status: 200,
    description: 'Bulk send status',
    schema: {
      type: 'object',
      properties: {
        bulkJobId: { type: 'string' },
        total: { type: 'number' },
        completed: { type: 'number' },
        failed: { type: 'number' },
        active: { type: 'number' },
        waiting: { type: 'number' },
      },
    },
  })
  async getSendStatus(@Param('jobId') jobId: string) {
    return this.bulkContactService.getSendStatus(jobId);
  }
}
