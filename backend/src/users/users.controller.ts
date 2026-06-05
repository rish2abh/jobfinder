import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { MongoIdParamDto } from './dto/mongo-id-param.dto';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ── POST /users ───────────────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Create a new user' })
  async create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  // ── GET /users/by-email/:email ───────────────────────────────────────────

  @Get('by-email/:email')
  @ApiOperation({ summary: 'Find a user by email address (for returning user login)' })
  @ApiParam({ name: 'email', example: 'alice@example.com' })
  async findByEmail(@Param('email') email: string) {
    return this.usersService.findByEmail(email);
  }

  // ── GET /users/:id ────────────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiParam({ name: 'id', example: '665df8d2f98f48bd8f04f2a1' })
  async findById(@Param() params: MongoIdParamDto) {
    return this.usersService.findById(params.id);
  }

  // ── GET /users/:id/resume ─────────────────────────────────────────────────

  @Get(':id/resume')
  @ApiOperation({ summary: 'Get parsed resume details for a user' })
  @ApiParam({ name: 'id', example: '665df8d2f98f48bd8f04f2a1' })
  async getResume(@Param() params: MongoIdParamDto) {
    const user = await this.usersService.findById(params.id);
    return {
      resume:        user.resume,
      rawText:       user.resumeRawText,
      cloudinaryUrl: user.resumeCloudinaryUrl,
    };
  }

  // ── GET /users/:id/profile ────────────────────────────────────────────────

  @Get(':id/profile')
  @ApiOperation({
    summary: 'Get the structured job-application profile for a user',
    description:
      'Returns the profile object that is auto-populated from the parsed ' +
      'resume and editable by the user.',
  })
  @ApiParam({ name: 'id', example: '665df8d2f98f48bd8f04f2a1' })
  async getProfile(@Param() params: MongoIdParamDto) {
    return this.usersService.getProfile(params.id);
  }

  // ── PATCH /users/:id/profile ──────────────────────────────────────────────

  @Patch(':id/profile')
  @ApiOperation({
    summary: 'Update the job-application profile (manual edits)',
    description:
      'All fields are optional — only provided fields are updated. ' +
      'Arrays (skills, experience, education, etc.) are replaced in full.',
  })
  @ApiParam({ name: 'id', example: '665df8d2f98f48bd8f04f2a1' })
  @ApiBody({ type: UpdateProfileDto })
  @ApiResponse({
    status: 200,
    description: 'Updated user document',
  })
  async updateProfile(
    @Param() params: MongoIdParamDto,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(params.id, dto);
  }

  // ── POST /users/:id/profile/extract ──────────────────────────────────────

  @Post(':id/profile/extract')
  @ApiOperation({
    summary: 'Re-extract profile from stored resume data',
    description:
      'Reads the existing parsed JSON (or raw text as fallback) and ' +
      'rebuilds the profile. Useful after re-parsing or when the profile is empty.',
  })
  @ApiParam({ name: 'id', example: '665df8d2f98f48bd8f04f2a1' })
  async extractProfile(@Param() params: MongoIdParamDto) {
    return this.usersService.extractProfileFromResume(params.id);
  }
}
