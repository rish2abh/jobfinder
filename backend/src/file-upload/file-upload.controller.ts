import {
  BadRequestException,
  Controller,
  Get,
  HttpStatus,
  Logger,
  Param,
  ParseFilePipeBuilder,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Request, Response } from 'express';
import axios from 'axios';
import { FileUploadService } from './file-upload.service';

@ApiTags('uploads')
@ApiBearerAuth()
@Controller('uploads')
export class FileUploadController {
  private readonly logger = new Logger(FileUploadController.name);

  constructor(private readonly fileUploadService: FileUploadService) {}

  // ── POST /uploads/resume ──────────────────────────────────────────────────

  @Post('resume')
  @ApiOperation({
    summary: 'Upload resume PDF and queue AI parsing',
    description:
      'Uploads the PDF to Cloudinary and extracts raw text synchronously (~2-4 s), ' +
      'then enqueues the Ollama LLM parsing as a background job. ' +
      'Returns { jobId, cloudinaryUrl } immediately. ' +
      'Poll GET /uploads/resume/status/:jobId for completion.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        source: { type: 'string', example: 'local' },
        provider: {
          type: 'string',
          enum: ['ollama', 'claude', 'llamaparse'],
          example: 'ollama',
          description: 'LLM provider to use for parsing',
        },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({
    status: 202,
    description: 'File uploaded, parse job queued',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', example: '7' },
        status: { type: 'string', example: 'queued' },
        cloudinaryUrl: { type: 'string' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  async uploadResume(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: 'pdf' })
        .addMaxSizeValidator({ maxSize: 15 * 1024 * 1024 })
        .build({
          errorHttpStatusCode: HttpStatus.BAD_REQUEST,
          fileIsRequired: true,
        }),
    )
    file: Express.Multer.File,
    @Req() req: Request,
  ) {
    const userId = (req.user as any)._id.toString();
    const providerInput = req.body?.provider as string | undefined;
    const validProviders = ['groq', 'ollama', 'claude', 'llamaparse'] as const;
    const provider: 'groq' | 'ollama' | 'claude' | 'llamaparse' =
      validProviders.includes(providerInput as any)
        ? (providerInput as 'groq' | 'ollama' | 'claude' | 'llamaparse')
        : 'groq';
    return this.fileUploadService.uploadResume(file, userId, provider);
  }

  // ── GET /uploads/resume/status/:jobId ─────────────────────────────────────

  @Get('resume/status/:jobId')
  @ApiOperation({
    summary: 'Poll the status of a resume parse job',
  })
  @ApiParam({ name: 'jobId', example: '7' })
  async getParseJobStatus(@Param('jobId') jobId: string) {
    return this.fileUploadService.getParseJobStatus(jobId);
  }

  // ── POST /uploads/resume/reparse ──────────────────────────────────────────

  @Post('resume/reparse')
  @ApiOperation({
    summary: 'Re-run Ollama parsing on stored raw text — no re-upload needed',
  })
  async reparseResume(@Req() req: Request) {
    const userId = (req.user as any)._id.toString();
    return this.fileUploadService.reparseResume(userId);
  }

  // ── DELETE /uploads/resume/queue ──────────────────────────────────────────

  @Post('resume/queue/clean')
  @ApiOperation({
    summary: 'Clean the resume parse queue',
    description:
      'Removes all jobs (completed, failed, delayed, waiting, active) from the resume parse queue. ' +
      'Useful when the queue is stuck or you want to clear old jobs.',
  })
  @ApiResponse({ status: 200, description: 'Queue cleaned successfully' })
  async cleanQueue() {
    return this.fileUploadService.cleanQueue();
  }

  // ── GET /uploads/resume/proxy ──────────────────────────────────────────────
  //
  // Proxies a Cloudinary PDF URL through the backend.
  //
  // WHY THIS EXISTS:
  // Cloudinary serves PDFs with `Content-Disposition: attachment` by default,
  // which forces browsers to download instead of display.  Even with
  // `fl_attachment:false`, some Cloudinary plans / CDN regions override this.
  // Google Docs Viewer requires the URL to be publicly accessible from Google's
  // servers, which fails for private/restricted URLs (403).
  //
  // Proxying through our own backend guarantees:
  //   • Content-Type: application/pdf   → browser renders inline
  //   • Content-Disposition: inline     → no forced download
  //   • Same-origin response            → no CORS/CSP issues in <iframe>
  //   • No third-party dependency       → no Google Docs 403

  @Get('resume/proxy')
  @ApiOperation({
    summary: 'Proxy a Cloudinary PDF URL for inline browser rendering',
    description:
      'Fetches the PDF from Cloudinary and re-serves it with ' +
      'Content-Disposition: inline so the browser displays it natively. ' +
      'Pass the full Cloudinary URL as the `url` query parameter.',
  })
  @ApiQuery({
    name: 'url',
    required: true,
    description: 'Cloudinary PDF URL to proxy',
  })
  async proxyPdf(@Query('url') url: string, @Res() res: Response) {
    if (!url) {
      throw new BadRequestException('url query parameter is required');
    }

    // Only allow proxying from Cloudinary to prevent open-redirect abuse
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('Invalid URL');
    }

    // Strict domain check — only allow res.cloudinary.com (the CDN hostname)
    // A simple endsWith check is vulnerable to subdomain spoofing (e.g. evil-cloudinary.com)
    const allowed =
      parsed.hostname === 'res.cloudinary.com' ||
      parsed.hostname.endsWith('.res.cloudinary.com');
    if (!allowed) {
      throw new BadRequestException(
        'Only Cloudinary CDN URLs (res.cloudinary.com) are allowed',
      );
    }

    try {
      const upstream = await axios.get<Buffer>(url, {
        responseType: 'arraybuffer',
        timeout: 20_000,
        // Forward a neutral user-agent so Cloudinary doesn't block
        headers: { 'User-Agent': 'JobfinderApp/1.0' },
      });

      const contentLength = upstream.headers['content-length'];

      // Set headers that guarantee inline PDF rendering in the browser
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="resume.pdf"');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      if (contentLength && typeof contentLength === 'string') {
        res.setHeader('Content-Length', contentLength);
      }

      // Allow the frontend iframe to embed this response
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');

      res.status(200).send(Buffer.from(upstream.data));
    } catch (err: any) {
      const status = err?.response?.status ?? 502;
      this.logger.error(`PDF proxy failed for ${url}: ${err?.message}`);
      res
        .status(status)
        .json({ message: `Failed to fetch PDF: ${err?.message}` });
    }
  }
}
