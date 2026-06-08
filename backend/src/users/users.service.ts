import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersRepository } from './users.repository';
import {
  extractProfileFromParsedJson,
  extractProfileFromRawText,
} from './profile-extractor';
import type { RefreshTokenEntry, UserProfile } from './user.schema';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  // ── Create ────────────────────────────────────────────────────────────────

  async create(createUserDto: CreateUserDto) {
    try {
      return await this.usersRepository.create(createUserDto);
    } catch (err: any) {
      if (err?.code === 11000 || err?.name === 'MongoServerError') {
        throw new ConflictException(
          `An account with email "${createUserDto.email}" already exists`,
        );
      }
      throw err;
    }
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  async findById(id: string) {
    const user = await this.usersRepository.findById(id);
    if (!user) throw new NotFoundException(`User not found: ${id}`);
    return user;
  }

  async findByEmail(email: string) {
    const user = await this.usersRepository.findByEmail(email);
    if (!user) throw new NotFoundException(`No account found for email: ${email}`);
    return user;
  }

  // ── Save resume (called by the parse processor) ───────────────────────────

  async saveResume(
    userId: string,
    resumeData: { parsedJson: any; rawText: string; cloudinaryUrl: string; cloudinaryId: string },
  ) {
    const user = await this.findById(userId);
    const saved = await this.usersRepository.saveResume(user, resumeData);

    // Auto-populate the profile from the newly parsed JSON
    // so it's ready to use without the user having to manually save
    const profileUpdates = extractProfileFromParsedJson(resumeData.parsedJson);

    // If JSON parse failed (fallback object) try raw text extraction instead
    const useFallback =
      !profileUpdates.skills?.length && !profileUpdates.experience?.length;

    const updates = useFallback
      ? extractProfileFromRawText(resumeData.rawText)
      : profileUpdates;

    if (Object.keys(updates).length > 1) {
      // Refetch the saved doc to merge profile into it
      const freshUser = await this.findById(userId);
      await this.usersRepository.updateProfile(freshUser, updates);
    }

    return saved;
  }

  // ── Get profile ───────────────────────────────────────────────────────────

  async getProfile(userId: string): Promise<UserProfile & { name: string; email: string }> {
    const user = await this.findById(userId);
    return {
      name:  user.name,
      email: user.email,
      ...(user.profile as UserProfile ?? {}),
    };
  }

  // ── Update profile (manual edits from frontend) ───────────────────────────

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.findById(userId);

    // Separate top-level User fields from profile fields
    const { name, email, ...profileFields } = dto;

    const profileUpdates: Partial<UserProfile> = {
      ...profileFields,
      lastUpdatedFrom: 'manual',
      updatedAt: new Date(),
    };

    return this.usersRepository.updateProfile(
      user,
      profileUpdates,
      { name, email },
    );
  }

  // ── Re-extract profile from raw text (on-demand) ─────────────────────────

  async extractProfileFromResume(userId: string): Promise<UserProfile & { name: string; email: string }> {
    const user = await this.findById(userId);

    // Prefer structured JSON; fall back to raw text
    let updates: Partial<UserProfile>;

    if (user.resume && Object.keys(user.resume).length > 0 && !('_parseError' in user.resume)) {
      updates = extractProfileFromParsedJson(user.resume);
    } else if (user.resumeRawText) {
      updates = extractProfileFromRawText(user.resumeRawText);
    } else {
      throw new NotFoundException('No resume data found. Upload a PDF first.');
    }

    const updated = await this.usersRepository.updateProfile(user, updates);
    if (!updated) throw new NotFoundException(`User not found: ${userId}`);

    return {
      name:  updated.name,
      email: updated.email,
      ...(updated.profile as UserProfile ?? {}),
    };
  }

  // ── Auth-related methods (delegating to repository) ─────────────────────

  async findByEmailOptional(email: string) {
    return this.usersRepository.findByEmail(email);
  }

  async updatePassword(userId: string, hashedPassword: string) {
    return this.usersRepository.updatePassword(userId, hashedPassword);
  }

  async addRefreshToken(userId: string, tokenEntry: RefreshTokenEntry) {
    return this.usersRepository.addRefreshToken(userId, tokenEntry);
  }

  async removeRefreshToken(userId: string, tokenHash: string) {
    return this.usersRepository.removeRefreshToken(userId, tokenHash);
  }

  async incrementFailedAttempts(userId: string) {
    return this.usersRepository.incrementFailedAttempts(userId);
  }

  async resetFailedAttempts(userId: string) {
    return this.usersRepository.resetFailedAttempts(userId);
  }

  async lockAccount(userId: string, lockedUntil: Date) {
    return this.usersRepository.lockAccount(userId, lockedUntil);
  }
}
