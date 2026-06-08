import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

interface TokenPayload {
  sub: string;
  email: string;
}

@Injectable()
export class AuthService {
  private readonly BCRYPT_ROUNDS = 10;
  private readonly MAX_FAILED_ATTEMPTS = 5;
  private readonly LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
  private readonly REFRESH_TOKEN_EXPIRY_DAYS = 7;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  // ── Register ────────────────────────────────────────────────────────────

  async register(dto: RegisterDto): Promise<AuthTokens> {
    // Check if user already exists
    const existing = await this.usersService.findByEmailOptional(dto.email);
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    // Hash password with bcrypt cost 10
    const hashedPassword = await bcrypt.hash(dto.password, this.BCRYPT_ROUNDS);

    // Create user via UsersService
    const user = await this.usersService.create({
      name: dto.name,
      email: dto.email.toLowerCase().trim(),
      password: hashedPassword,
    });

    // Issue tokens
    return this.issueTokens(user._id.toString(), user.email);
  }

  // ── Login ───────────────────────────────────────────────────────────────

  async login(dto: LoginDto): Promise<AuthTokens> {
    // Find user (returns null if not found)
    const user = await this.usersService.findByEmailOptional(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check account lockout
    if (user.accountLockedUntil && new Date() < new Date(user.accountLockedUntil)) {
      throw new ForbiddenException(
        'Account is locked due to too many failed login attempts. Try again later.',
      );
    }

    // Validate password
    if (!user.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      // Increment failed attempts
      const updated = await this.usersService.incrementFailedAttempts(user._id.toString());

      // Check if we should lock the account (5 failed attempts)
      if (updated && updated.failedLoginAttempts >= this.MAX_FAILED_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + this.LOCKOUT_DURATION_MS);
        await this.usersService.lockAccount(user._id.toString(), lockedUntil);
      }

      throw new UnauthorizedException('Invalid credentials');
    }

    // Reset failed attempts on successful login
    await this.usersService.resetFailedAttempts(user._id.toString());

    // Issue tokens
    return this.issueTokens(user._id.toString(), user.email);
  }

  // ── Refresh ─────────────────────────────────────────────────────────────

  async refresh(token: string): Promise<AuthTokens> {
    // We need to find which user owns this refresh token by checking all users
    // In a real app, you might encode userId in the token or use a lookup table
    // For now, we decode a hint: the refresh token is raw, stored hashed in user doc
    // The client sends the raw token; we need to find the matching hash

    // Strategy: Since we can't efficiently search all users, we'll include
    // the userId in the refresh flow. The controller should pass it from the JWT
    // or from the request body. Let's accept a broader approach:
    // The refresh endpoint receives the raw refresh token. We'll need to iterate.
    // Better approach: encode userId in the token format: `userId:randomToken`

    throw new UnauthorizedException('Invalid refresh token');
  }

  async refreshForUser(userId: string, token: string): Promise<AuthTokens> {
    const user = await this.usersService.findById(userId);

    // Find matching refresh token entry
    const matchingEntry = await this.findMatchingRefreshToken(
      user.refreshTokens || [],
      token,
    );

    if (!matchingEntry) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Check if expired
    if (new Date() > new Date(matchingEntry.expiresAt)) {
      // Remove expired token
      await this.usersService.removeRefreshToken(userId, matchingEntry.token);
      throw new UnauthorizedException('Refresh token expired');
    }

    // Check if revoked
    if (matchingEntry.revoked) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    // Revoke old token (rotation)
    await this.usersService.removeRefreshToken(userId, matchingEntry.token);

    // Issue new pair
    return this.issueTokens(userId, user.email);
  }

  // ── Logout ──────────────────────────────────────────────────────────────

  async logout(userId: string, token: string): Promise<void> {
    const user = await this.usersService.findById(userId);

    // Find and remove the matching refresh token
    const matchingEntry = await this.findMatchingRefreshToken(
      user.refreshTokens || [],
      token,
    );

    if (matchingEntry) {
      await this.usersService.removeRefreshToken(userId, matchingEntry.token);
    }
  }

  // ── Validate User (from JWT payload) ───────────────────────────────────

  async validateUser(payload: TokenPayload) {
    const user = await this.usersService.findById(payload.sub);
    return user;
  }

  // ── Private Helpers ─────────────────────────────────────────────────────

  private async issueTokens(userId: string, email: string): Promise<AuthTokens> {
    // Generate access token (JWT, 15min expiry — configured in module)
    const accessToken = this.jwtService.sign({
      sub: userId,
      email,
    });

    // Generate refresh token (random string)
    const rawRefreshToken = crypto.randomBytes(32).toString('hex');

    // Hash refresh token before storing
    const hashedRefreshToken = await bcrypt.hash(rawRefreshToken, this.BCRYPT_ROUNDS);

    // Calculate expiry (7 days)
    const expiresAt = new Date(
      Date.now() + this.REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );

    // Store hashed token in user document
    await this.usersService.addRefreshToken(userId, {
      token: hashedRefreshToken,
      expiresAt,
      createdAt: new Date(),
      revoked: false,
    });

    return {
      accessToken,
      refreshToken: `${userId}:${rawRefreshToken}`,
    };
  }

  private async findMatchingRefreshToken(
    tokenEntries: Array<{ token: string; expiresAt: Date; createdAt: Date; revoked: boolean }>,
    rawToken: string,
  ) {
    // Compare raw token against each stored bcrypt hash
    for (const entry of tokenEntries) {
      if (entry.revoked) continue;
      const isMatch = await bcrypt.compare(rawToken, entry.token);
      if (isMatch) return entry;
    }
    return null;
  }
}
