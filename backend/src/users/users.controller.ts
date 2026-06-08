import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { Public } from '../auth/public.decorator';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ── POST /users ───────────────────────────────────────────────────────────

  @Public()
  @Post()
  @ApiOperation({ summary: 'Create a new user (legacy registration)' })
  async create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  // ── GET /users/by-email/:email ───────────────────────────────────────────

  @Public()
  @Get('by-email/:email')
  @ApiOperation({ summary: 'Find a user by email address (for returning user login)' })
  @ApiParam({ name: 'email', example: 'alice@example.com' })
  async findByEmail(@Param('email') email: string) {
    return this.usersService.findByEmail(email);
  }

  // ── GET /users/me ─────────────────────────────────────────────────────────

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the authenticated user' })
  async findMe(@Req() req: Request) {
    const userId = (req.user as any)._id.toString();
    return this.usersService.findById(userId);
  }

  // ── GET /users/me/resume ──────────────────────────────────────────────────

  @Get('me/resume')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get parsed resume details for the authenticated user' })
  async getResume(@Req() req: Request) {
    const userId = (req.user as any)._id.toString();
    const user = await this.usersService.findById(userId);
    return {
      resume:        user.resume,
      rawText:       user.resumeRawText,
      cloudinaryUrl: user.resumeCloudinaryUrl,
    };
  }

  // ── GET /users/me/profile ─────────────────────────────────────────────────

  @Get('me/profile')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get the structured job-application profile for the authenticated user',
    description:
      'Returns the profile object that is auto-populated from the parsed ' +
      'resume and editable by the user.',
  })
  async getProfile(@Req() req: Request) {
    const userId = (req.user as any)._id.toString();
    return this.usersService.getProfile(userId);
  }

  // ── PATCH /users/me/profile ───────────────────────────────────────────────

  @Patch('me/profile')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update the job-application profile (manual edits)',
    description:
      'All fields are optional — only provided fields are updated. ' +
      'Arrays (skills, experience, education, etc.) are replaced in full.',
  })
  @ApiBody({ type: UpdateProfileDto })
  @ApiResponse({
    status: 200,
    description: 'Updated user document',
  })
  async updateProfile(
    @Req() req: Request,
    @Body() dto: UpdateProfileDto,
  ) {
    const userId = (req.user as any)._id.toString();
    return this.usersService.updateProfile(userId, dto);
  }

  // ── POST /users/me/profile/extract ───────────────────────────────────────

  @Post('me/profile/extract')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Re-extract profile from stored resume data',
    description:
      'Reads the existing parsed JSON (or raw text as fallback) and ' +
      'rebuilds the profile. Useful after re-parsing or when the profile is empty.',
  })
  async extractProfile(@Req() req: Request) {
    const userId = (req.user as any)._id.toString();
    return this.usersService.extractProfileFromResume(userId);
  }
}
