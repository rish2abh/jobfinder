import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException, ConflictException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

describe('AuthService', () => {
  let authService: AuthService;
  let usersService: Partial<Record<keyof UsersService, jest.Mock>>;
  let jwtService: Partial<Record<keyof JwtService, jest.Mock>>;

  beforeEach(async () => {
    usersService = {
      findByEmailOptional: jest.fn(),
      create: jest.fn(),
      findById: jest.fn(),
      addRefreshToken: jest.fn(),
      removeRefreshToken: jest.fn(),
      incrementFailedAttempts: jest.fn(),
      resetFailedAttempts: jest.fn(),
      lockAccount: jest.fn(),
    };

    jwtService = {
      sign: jest.fn().mockReturnValue('mock-access-token'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('should hash password and create user', async () => {
      usersService.findByEmailOptional.mockResolvedValue(null);
      usersService.create.mockResolvedValue({
        _id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
      });
      usersService.addRefreshToken.mockResolvedValue(null);

      const result = await authService.register({
        name: 'Test User',
        email: 'test@example.com',
        password: 'StrongP@ss1',
      });

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBeDefined();
      // Format: userId:hex (32 bytes hex = 64 chars + userId + colon)
      expect(result.refreshToken).toContain(':');
      const [userId, rawToken] = result.refreshToken.split(':');
      expect(userId).toBe('user-123');
      expect(rawToken.length).toBe(64);
      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test User',
          email: 'test@example.com',
          password: expect.any(String),
        }),
      );

      // Verify bcrypt was used (password should not be plain text)
      const callArgs = usersService.create.mock.calls[0][0];
      expect(callArgs.password).not.toBe('StrongP@ss1');
      const isHashed = await bcrypt.compare('StrongP@ss1', callArgs.password);
      expect(isHashed).toBe(true);
    });

    it('should throw ConflictException if email already exists', async () => {
      usersService.findByEmailOptional.mockResolvedValue({ _id: 'existing' });

      await expect(
        authService.register({
          name: 'Test',
          email: 'existing@example.com',
          password: 'password123',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    const mockUser = {
      _id: 'user-123',
      email: 'test@example.com',
      name: 'Test User',
      password: '', // will be set in beforeEach
      failedLoginAttempts: 0,
      accountLockedUntil: null,
      refreshTokens: [],
    };

    beforeEach(async () => {
      mockUser.password = await bcrypt.hash('correctPassword', 10);
    });

    it('should return tokens on valid credentials', async () => {
      usersService.findByEmailOptional.mockResolvedValue(mockUser);
      usersService.resetFailedAttempts.mockResolvedValue(null);
      usersService.addRefreshToken.mockResolvedValue(null);

      const result = await authService.login({
        email: 'test@example.com',
        password: 'correctPassword',
      });

      expect(result.accessToken).toBe('mock-access-token');
      // Format: userId:hex (32 bytes hex = 64 chars)
      expect(result.refreshToken).toContain(':');
      const [, rawToken] = result.refreshToken.split(':');
      expect(rawToken.length).toBe(64);
      expect(usersService.resetFailedAttempts).toHaveBeenCalledWith('user-123');
    });

    it('should throw UnauthorizedException for invalid password', async () => {
      usersService.findByEmailOptional.mockResolvedValue(mockUser);
      usersService.incrementFailedAttempts.mockResolvedValue({
        ...mockUser,
        failedLoginAttempts: 1,
      });

      await expect(
        authService.login({
          email: 'test@example.com',
          password: 'wrongPassword',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(usersService.incrementFailedAttempts).toHaveBeenCalledWith('user-123');
    });

    it('should throw UnauthorizedException for non-existent email', async () => {
      usersService.findByEmailOptional.mockResolvedValue(null);

      await expect(
        authService.login({
          email: 'nobody@example.com',
          password: 'anyPassword',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should lock account after 5 failed attempts', async () => {
      usersService.findByEmailOptional.mockResolvedValue(mockUser);
      usersService.incrementFailedAttempts.mockResolvedValue({
        ...mockUser,
        failedLoginAttempts: 5,
      });
      usersService.lockAccount.mockResolvedValue(null);

      await expect(
        authService.login({
          email: 'test@example.com',
          password: 'wrongPassword',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(usersService.lockAccount).toHaveBeenCalledWith(
        'user-123',
        expect.any(Date),
      );
    });

    it('should throw ForbiddenException for locked account', async () => {
      const lockedUser = {
        ...mockUser,
        accountLockedUntil: new Date(Date.now() + 10 * 60 * 1000), // 10 min from now
      };
      usersService.findByEmailOptional.mockResolvedValue(lockedUser);

      await expect(
        authService.login({
          email: 'test@example.com',
          password: 'correctPassword',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('refreshForUser', () => {
    it('should rotate tokens on valid refresh token', async () => {
      const rawToken = 'a'.repeat(64);
      const hashedToken = await bcrypt.hash(rawToken, 10);

      usersService.findById.mockResolvedValue({
        _id: 'user-123',
        email: 'test@example.com',
        refreshTokens: [
          {
            token: hashedToken,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            createdAt: new Date(),
            revoked: false,
          },
        ],
      });
      usersService.removeRefreshToken.mockResolvedValue(null);
      usersService.addRefreshToken.mockResolvedValue(null);

      const result = await authService.refreshForUser('user-123', rawToken);

      expect(result.accessToken).toBe('mock-access-token');
      // Format: userId:hex (32 bytes hex = 64 chars)
      expect(result.refreshToken).toContain(':');
      const [, newRawToken] = result.refreshToken.split(':');
      expect(newRawToken.length).toBe(64);
      expect(usersService.removeRefreshToken).toHaveBeenCalledWith('user-123', hashedToken);
    });

    it('should throw for invalid refresh token', async () => {
      usersService.findById.mockResolvedValue({
        _id: 'user-123',
        email: 'test@example.com',
        refreshTokens: [],
      });

      await expect(
        authService.refreshForUser('user-123', 'invalid-token'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw for expired refresh token', async () => {
      const rawToken = 'b'.repeat(64);
      const hashedToken = await bcrypt.hash(rawToken, 10);

      usersService.findById.mockResolvedValue({
        _id: 'user-123',
        email: 'test@example.com',
        refreshTokens: [
          {
            token: hashedToken,
            expiresAt: new Date(Date.now() - 1000), // expired
            createdAt: new Date(),
            revoked: false,
          },
        ],
      });
      usersService.removeRefreshToken.mockResolvedValue(null);

      await expect(
        authService.refreshForUser('user-123', rawToken),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('should remove the matching refresh token', async () => {
      const rawToken = 'c'.repeat(64);
      const hashedToken = await bcrypt.hash(rawToken, 10);

      usersService.findById.mockResolvedValue({
        _id: 'user-123',
        email: 'test@example.com',
        refreshTokens: [
          {
            token: hashedToken,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            createdAt: new Date(),
            revoked: false,
          },
        ],
      });
      usersService.removeRefreshToken.mockResolvedValue(null);

      await authService.logout('user-123', rawToken);

      expect(usersService.removeRefreshToken).toHaveBeenCalledWith('user-123', hashedToken);
    });

    it('should not throw if token not found', async () => {
      usersService.findById.mockResolvedValue({
        _id: 'user-123',
        email: 'test@example.com',
        refreshTokens: [],
      });

      await expect(
        authService.logout('user-123', 'non-existent-token'),
      ).resolves.not.toThrow();
    });
  });

  describe('validateUser', () => {
    it('should return user from JWT payload', async () => {
      const mockUser = { _id: 'user-123', email: 'test@example.com', name: 'Test' };
      usersService.findById.mockResolvedValue(mockUser);

      const result = await authService.validateUser({ sub: 'user-123', email: 'test@example.com' });

      expect(result).toEqual(mockUser);
      expect(usersService.findById).toHaveBeenCalledWith('user-123');
    });
  });
});
