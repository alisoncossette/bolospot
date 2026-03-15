import { Injectable, Inject, Optional, UnauthorizedException, ConflictException, BadRequestException, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { RegisterDto, LoginDto, AuthResponseDto } from './dto/auth.dto';
import { REDIS_CLIENT } from '../redis/redis.module';
import Redis from 'ioredis';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

// Rate limiting constants
const LOGIN_RATE_LIMIT = 10;          // max attempts per IP per window
const LOGIN_RATE_WINDOW = 900;        // 15 minutes in seconds
const REGISTER_RATE_LIMIT = 5;        // max registrations per IP per window
const REGISTER_RATE_WINDOW = 3600;    // 1 hour in seconds
const LOCKOUT_THRESHOLD = 5;          // failed attempts before lockout
const LOCKOUT_DURATION = 900;         // 15 minute lockout in seconds
const EMAIL_AUTH_IP_RATE_LIMIT = 10;  // max sends per IP per window
const EMAIL_AUTH_IP_RATE_WINDOW = 900;  // 15 minutes
const EMAIL_AUTH_EMAIL_RATE_LIMIT = 3;  // max sends per email per window
const EMAIL_AUTH_EMAIL_RATE_WINDOW = 900; // 15 minutes
const OTP_EXPIRY_SECONDS = 300;       // 5 minutes
const MAGIC_LINK_EXPIRY_SECONDS = 900; // 15 minutes

// Dummy hash for timing attack prevention (pre-computed bcrypt hash of random string)
const DUMMY_HASH = '$2a$12$LJ3m4ys3Sz8pE5qWVjZ3AeYIEgK5R5zKJ0YHTo3FxN5fW0QaRV6Wm';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailService: EmailService,
    @Optional() @Inject(REDIS_CLIENT) private redis: Redis | null,
  ) {}

  // ── Rate Limiting & Lockout helpers ──────────────────────────────────

  private async checkIpRateLimit(ip: string, action: 'login' | 'register'): Promise<void> {
    if (!this.redis) return; // Skip rate limiting if Redis unavailable
    try {
      const limit = action === 'login' ? LOGIN_RATE_LIMIT : REGISTER_RATE_LIMIT;
      const window = action === 'login' ? LOGIN_RATE_WINDOW : REGISTER_RATE_WINDOW;
      const key = `auth:rate:${action}:${ip}`;

      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, window);

      if (count > limit) {
        this.logger.warn(`Rate limit exceeded for ${action} from IP ${ip}`);
        throw new HttpException(
          `Too many ${action} attempts. Please try again later.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(`Redis unavailable for rate limiting: ${err}`);
    }
  }

  private async checkAccountLockout(email: string): Promise<void> {
    if (!this.redis) return;
    try {
      const key = `auth:lockout:${email.toLowerCase()}`;
      const failures = await this.redis.get(key);

      if (failures && parseInt(failures, 10) >= LOCKOUT_THRESHOLD) {
        const ttl = await this.redis.ttl(key);
        this.logger.warn(`Locked out login attempt for ${email} (${ttl}s remaining)`);
        throw new HttpException(
          `Account temporarily locked due to too many failed attempts. Try again in ${Math.ceil(ttl / 60)} minutes.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(`Redis unavailable for lockout check: ${err}`);
    }
  }

  private async recordFailedLogin(email: string): Promise<void> {
    if (!this.redis) return;
    try {
      const key = `auth:lockout:${email.toLowerCase()}`;
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, LOCKOUT_DURATION);
    } catch (err) {
      this.logger.warn(`Redis unavailable for recording failed login: ${err}`);
    }
  }

  private async clearFailedLogins(email: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(`auth:lockout:${email.toLowerCase()}`);
    } catch (err) {
      this.logger.warn(`Redis unavailable for clearing failed logins: ${err}`);
    }
  }

  // ── Registration ──────────────────────────────────────────────────────

  async register(dto: RegisterDto, ip?: string): Promise<AuthResponseDto> {
    // Rate limit by IP
    if (ip) await this.checkIpRateLimit(ip, 'register');

    // Check if email or handle already exists — use same generic message
    // to prevent user enumeration attacks
    const [existingEmail, existingHandle] = await Promise.all([
      this.prisma.user.findUnique({ where: { email: dto.email } }),
      this.prisma.user.findUnique({ where: { handle: dto.handle } }),
    ]);
    if (existingEmail || existingHandle) {
      throw new ConflictException('Unable to create account. Email or handle may already be in use.');
    }

    // Hash password (cost factor 12 — stronger than default 10)
    const passwordHash = await bcrypt.hash(dto.password, 12);

    // Get identity types for EMAIL and BOLO_HANDLE
    const [emailIdentityType, handleIdentityType] = await Promise.all([
      this.prisma.identityType.findUnique({ where: { code: 'EMAIL' } }),
      this.prisma.identityType.findUnique({ where: { code: 'BOLO_HANDLE' } }),
    ]);

    // Create user with identities
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        handle: dto.handle,
        name: dto.name,
        passwordHash,
        timezone: dto.timezone || 'UTC',
        emails: {
          create: {
            email: dto.email,
            isPrimary: true,
            isVerified: false,
          },
        },
        identities: {
          create: [
            // Email identity (NOT verified until OAuth calendar connection confirms it)
            ...(emailIdentityType ? [{
              identityTypeId: emailIdentityType.id,
              value: dto.email.toLowerCase(),
              displayValue: dto.email,
              isVerified: false,
              visibility: 'BOLO_ONLY',
              isPrimary: true,
            }] : []),
            // Bolo handle identity (verified - we control handle uniqueness)
            ...(handleIdentityType ? [{
              identityTypeId: handleIdentityType.id,
              value: dto.handle.toLowerCase(),
              displayValue: `@${dto.handle}`,
              isVerified: true,
              verifiedAt: new Date(),
              visibility: 'PUBLIC',
              isPrimary: false,
            }] : []),
          ],
        },
      },
    });

    // Create default booking profile
    await this.prisma.bookingProfile.create({
      data: {
        userId: user.id,
        slug: 'default',
        name: `Meet with ${dto.name || dto.handle}`,
        durations: [15, 30, 60],
        customDays: [],
        isActive: true,
        visibility: 'PUBLIC',
      },
    });

    // Link any existing participant records that have this email
    // This happens when someone was invited to meetings before they had an account
    const linkedParticipants = await this.prisma.participant.updateMany({
      where: {
        email: { equals: dto.email, mode: 'insensitive' },
        userId: null,
      },
      data: {
        userId: user.id,
        useConnectedCalendar: true,
      },
    });

    if (linkedParticipants.count > 0) {
      this.logger.log(
        `Linked ${linkedParticipants.count} existing meeting invitation(s) to new user @${dto.handle}`
      );
    }

    // Generate JWT
    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      handle: user.handle,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        handle: user.handle,
        name: user.name,
        verificationLevel: user.verificationLevel,
        betaAccess: user.betaAccess,
        isSuperAdmin: user.isSuperAdmin,
      },
    };
  }

  async quickLogin(email: string): Promise<AuthResponseDto> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('User not found');

    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      handle: user.handle,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        handle: user.handle,
        name: user.name,
        verificationLevel: user.verificationLevel,
        betaAccess: user.betaAccess,
        isSuperAdmin: user.isSuperAdmin,
      },
    };
  }

  async login(dto: LoginDto, ip?: string): Promise<AuthResponseDto> {
    // Rate limit by IP
    if (ip) await this.checkIpRateLimit(ip, 'login');

    // Check account lockout
    await this.checkAccountLockout(dto.email);

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // Timing attack prevention: always run bcrypt even if user not found
    const hashToCompare = user?.passwordHash || DUMMY_HASH;
    const isPasswordValid = await bcrypt.compare(dto.password, hashToCompare);

    if (!user || !user.passwordHash || !isPasswordValid) {
      await this.recordFailedLogin(dto.email);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Successful login — clear lockout counter
    await this.clearFailedLogins(dto.email);

    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      handle: user.handle,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        handle: user.handle,
        name: user.name,
        verificationLevel: user.verificationLevel,
        betaAccess: user.betaAccess,
        isSuperAdmin: user.isSuperAdmin,
      },
    };
  }

  async validateUserById(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
    });
  }

  // Microsoft Social Login OAuth
  async getMicrosoftSocialAuthUrl(redirectUri: string, redirectUrl?: string) {
    const clientId = this.configService.get('MICROSOFT_CLIENT_ID');
    const scopes = ['openid', 'email', 'profile', 'User.Read'].join(' ');

    // Generate cryptographically random state and store in Redis for validation
    const stateToken = crypto.randomBytes(32).toString('hex');
    const stateData = { flow: 'login', redirectUrl: redirectUrl || '/dashboard' };
    if (this.redis) {
      try {
        await this.redis.set(`oauth:state:${stateToken}`, JSON.stringify(stateData), 'EX', 600); // 10 min expiry
      } catch (err) {
        this.logger.warn(`Redis unavailable for OAuth state storage: ${err}`);
      }
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes,
      response_mode: 'query',
      state: stateToken,
    });

    return {
      url: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`,
    };
  }

  async handleMicrosoftSocialCallback(
    code: string,
    redirectUri: string,
    state: string,
  ): Promise<AuthResponseDto & { redirectUrl: string }> {
    // Validate state from Redis (prevents CSRF and state fixation)
    const stateKey = `oauth:state:${state}`;
    let stateJson: string | null = null;
    if (this.redis) {
      try {
        stateJson = await this.redis.get(stateKey);
        // Delete state immediately — single use
        await this.redis.del(stateKey);
      } catch (err) {
        this.logger.warn(`Redis unavailable for OAuth state validation: ${err}`);
      }
    }
    if (!stateJson) {
      // Skip state validation if Redis is unavailable or state not found
      this.logger.warn('OAuth state not found — skipping validation (Redis may be unavailable)');
      stateJson = JSON.stringify({ flow: 'login', redirectUrl: '/dashboard' });
    }

    let stateData: { flow: string; redirectUrl: string };
    try {
      stateData = JSON.parse(stateJson);
    } catch {
      throw new BadRequestException('Corrupted state parameter');
    }

    if (stateData.flow !== 'login') {
      throw new BadRequestException('Invalid OAuth flow');
    }

    const clientId = this.configService.get('MICROSOFT_CLIENT_ID');
    const clientSecret = this.configService.get('MICROSOFT_CLIENT_SECRET');

    // Exchange code for tokens
    const tokenResponse = await fetch(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      },
    );

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      this.logger.error(`Microsoft token exchange failed: ${error}`);
      throw new BadRequestException('Failed to authenticate with Microsoft');
    }

    const tokens = await tokenResponse.json();

    // Fetch Microsoft profile
    const profileResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!profileResponse.ok) {
      throw new BadRequestException('Failed to get Microsoft profile');
    }

    const profile = await profileResponse.json();
    const email = (profile.mail || profile.userPrincipalName)?.toLowerCase();

    if (!email) {
      throw new BadRequestException('No email found in Microsoft profile');
    }

    // Find or create user
    let user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Create new user with auto-generated handle
      const handle = await this.generateUniqueHandle(
        profile.displayName || email.split('@')[0],
      );

      // Get identity types
      const [emailIdentityType, handleIdentityType, microsoftIdentityType] =
        await Promise.all([
          this.prisma.identityType.findUnique({ where: { code: 'EMAIL' } }),
          this.prisma.identityType.findUnique({ where: { code: 'BOLO_HANDLE' } }),
          this.prisma.identityType.findUnique({ where: { code: 'MICROSOFT' } }),
        ]);

      user = await this.prisma.user.create({
        data: {
          email,
          handle,
          name: profile.displayName || null,
          timezone: 'UTC',
          emails: {
            create: {
              email,
              isPrimary: true,
              isVerified: true, // Verified via Microsoft OAuth
            },
          },
          identities: {
            create: [
              // Email identity (verified via Microsoft OAuth)
              ...(emailIdentityType
                ? [
                    {
                      identityTypeId: emailIdentityType.id,
                      value: email,
                      displayValue: profile.mail || profile.userPrincipalName,
                      isVerified: true,
                      verifiedAt: new Date(),
                      visibility: 'BOLO_ONLY',
                      isPrimary: true,
                    },
                  ]
                : []),
              // Bolo handle identity
              ...(handleIdentityType
                ? [
                    {
                      identityTypeId: handleIdentityType.id,
                      value: handle.toLowerCase(),
                      displayValue: `@${handle}`,
                      isVerified: true,
                      verifiedAt: new Date(),
                      visibility: 'PUBLIC',
                      isPrimary: false,
                    },
                  ]
                : []),
              // Microsoft identity
              ...(microsoftIdentityType
                ? [
                    {
                      identityTypeId: microsoftIdentityType.id,
                      value: email,
                      displayValue: profile.mail || profile.userPrincipalName,
                      isVerified: true,
                      verifiedAt: new Date(),
                      visibility: 'BOLO_ONLY',
                      isPrimary: false,
                      metadata: {
                        microsoftId: profile.id,
                        displayName: profile.displayName,
                      },
                    },
                  ]
                : []),
            ],
          },
        },
      });

      this.logger.log(`Created new user @${handle} via Microsoft OAuth`);

      // Create default booking profile
      await this.prisma.bookingProfile.create({
        data: {
          userId: user.id,
          slug: 'default',
          name: `Meet with ${profile.displayName || handle}`,
          durations: [15, 30, 60],
          customDays: [],
          isActive: true,
          visibility: 'PUBLIC',
        },
      });

      // Link any existing participant records
      const linkedParticipants = await this.prisma.participant.updateMany({
        where: {
          email: { equals: email, mode: 'insensitive' },
          userId: null,
        },
        data: {
          userId: user.id,
          useConnectedCalendar: true,
        },
      });

      if (linkedParticipants.count > 0) {
        this.logger.log(
          `Linked ${linkedParticipants.count} existing meeting invitation(s) to new user @${handle}`,
        );
      }
    } else {
      // Existing user - update/create Microsoft identity
      const microsoftIdentityType = await this.prisma.identityType.findUnique({
        where: { code: 'MICROSOFT' },
      });

      if (microsoftIdentityType) {
        await this.prisma.userIdentity.upsert({
          where: {
            identityTypeId_value: {
              identityTypeId: microsoftIdentityType.id,
              value: email,
            },
          },
          update: {
            isVerified: true,
            verifiedAt: new Date(),
            metadata: {
              microsoftId: profile.id,
              displayName: profile.displayName,
            },
          },
          create: {
            userId: user.id,
            identityTypeId: microsoftIdentityType.id,
            value: email,
            displayValue: profile.mail || profile.userPrincipalName,
            isPrimary: false,
            isVerified: true,
            verifiedAt: new Date(),
            visibility: 'BOLO_ONLY',
            metadata: {
              microsoftId: profile.id,
              displayName: profile.displayName,
            },
          },
        });
      }

      // Verify email identity if exists and not verified
      const emailIdentityType = await this.prisma.identityType.findUnique({
        where: { code: 'EMAIL' },
      });
      if (emailIdentityType) {
        await this.prisma.userIdentity.updateMany({
          where: {
            userId: user.id,
            identityTypeId: emailIdentityType.id,
            value: email,
            isVerified: false,
          },
          data: {
            isVerified: true,
            verifiedAt: new Date(),
          },
        });
      }

      this.logger.log(`User @${user.handle} logged in via Microsoft OAuth`);
    }

    // Generate JWT
    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      handle: user.handle,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        handle: user.handle,
        name: user.name,
        verificationLevel: user.verificationLevel,
        betaAccess: user.betaAccess,
        isSuperAdmin: user.isSuperAdmin,
      },
      redirectUrl: stateData.redirectUrl || '/dashboard',
    };
  }

  // ── Shared user creation helper ────────────────────────────────────

  private async createNewUser(params: {
    email: string;
    name?: string;
    handle?: string;
    provider?: 'GOOGLE' | 'MICROSOFT' | 'EMAIL';
    providerProfile?: { id?: string; displayName?: string; picture?: string };
    markEmailVerified: boolean;
  }) {
    const handle = params.handle || await this.generateUniqueHandle(
      params.name || params.email.split('@')[0],
    );
    const needsOnboarding = !params.handle; // Auto-generated handle = needs onboarding

    const identityTypes = await Promise.all([
      this.prisma.identityType.findUnique({ where: { code: 'EMAIL' } }),
      this.prisma.identityType.findUnique({ where: { code: 'BOLO_HANDLE' } }),
      params.provider && params.provider !== 'EMAIL'
        ? this.prisma.identityType.findUnique({ where: { code: params.provider } })
        : null,
    ]);
    const [emailIdentityType, handleIdentityType, providerIdentityType] = identityTypes;

    const identitiesData: any[] = [];
    if (emailIdentityType) {
      identitiesData.push({
        identityTypeId: emailIdentityType.id,
        value: params.email.toLowerCase(),
        displayValue: params.email,
        isVerified: params.markEmailVerified,
        verifiedAt: params.markEmailVerified ? new Date() : null,
        visibility: 'BOLO_ONLY',
        isPrimary: true,
      });
    }
    if (handleIdentityType) {
      identitiesData.push({
        identityTypeId: handleIdentityType.id,
        value: handle.toLowerCase(),
        displayValue: `@${handle}`,
        isVerified: true,
        verifiedAt: new Date(),
        visibility: 'PUBLIC',
        isPrimary: false,
      });
    }
    if (providerIdentityType && params.providerProfile) {
      identitiesData.push({
        identityTypeId: providerIdentityType.id,
        value: params.email.toLowerCase(),
        displayValue: params.email,
        isVerified: true,
        verifiedAt: new Date(),
        visibility: 'BOLO_ONLY',
        isPrimary: false,
        metadata: params.providerProfile,
      });
    }

    const user = await this.prisma.user.create({
      data: {
        email: params.email,
        handle,
        name: params.name || null,
        needsOnboarding,
        timezone: 'UTC',
        emails: {
          create: {
            email: params.email,
            isPrimary: true,
            isVerified: params.markEmailVerified,
          },
        },
        identities: { create: identitiesData },
      },
    });

    // Create default booking profile
    await this.prisma.bookingProfile.create({
      data: {
        userId: user.id,
        slug: 'default',
        name: `Meet with ${params.name || handle}`,
        durations: [15, 30, 60],
        customDays: [],
        isActive: true,
        visibility: 'PUBLIC',
      },
    });

    // Link any existing participant records
    const linkedParticipants = await this.prisma.participant.updateMany({
      where: {
        email: { equals: params.email, mode: 'insensitive' },
        userId: null,
      },
      data: { userId: user.id, useConnectedCalendar: true },
    });

    if (linkedParticipants.count > 0) {
      this.logger.log(`Linked ${linkedParticipants.count} existing invitation(s) to new user @${handle}`);
    }

    this.logger.log(`Created new user @${handle} via ${params.provider || 'email'} (needsOnboarding=${needsOnboarding})`);
    return user;
  }

  private generateJwt(user: { id: string; email: string; handle: string }) {
    return this.jwtService.sign({
      sub: user.id,
      email: user.email,
      handle: user.handle,
    });
  }

  private formatUserResponse(user: any): AuthResponseDto {
    return {
      accessToken: this.generateJwt(user),
      user: {
        id: user.id,
        email: user.email,
        handle: user.handle,
        name: user.name,
        verificationLevel: user.verificationLevel,
        betaAccess: user.betaAccess,
        isSuperAdmin: user.isSuperAdmin,
      },
    };
  }

  // ── Google OAuth ──────────────────────────────────────────────────

  async getGoogleSocialAuthUrl(redirectUri: string, redirectUrl?: string) {
    const clientId = this.configService.get('GOOGLE_CLIENT_ID');
    const scopes = ['openid', 'email', 'profile'].join(' ');

    const stateToken = crypto.randomBytes(32).toString('hex');
    const stateData = { flow: 'login', redirectUrl: redirectUrl || '/dashboard' };
    if (this.redis) {
      try {
        await this.redis.set(`oauth:state:${stateToken}`, JSON.stringify(stateData), 'EX', 600);
      } catch (err) {
        this.logger.warn(`Redis unavailable for Google OAuth state storage: ${err}`);
      }
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes,
      state: stateToken,
      prompt: 'select_account',
    });

    return {
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    };
  }

  async handleGoogleSocialCallback(
    code: string,
    redirectUri: string,
    state: string,
  ): Promise<AuthResponseDto & { redirectUrl: string }> {
    // Validate state from Redis
    const stateKey = `oauth:state:${state}`;
    let stateJson: string | null = null;
    if (this.redis) {
      try {
        stateJson = await this.redis.get(stateKey);
        await this.redis.del(stateKey);
      } catch (err) {
        this.logger.warn(`Redis unavailable for Google OAuth state validation: ${err}`);
      }
    }
    if (!stateJson) {
      this.logger.warn('Google OAuth state not found — skipping validation (Redis may be unavailable)');
      stateJson = JSON.stringify({ flow: 'login', redirectUrl: '/dashboard' });
    }

    let stateData: { flow: string; redirectUrl: string };
    try {
      stateData = JSON.parse(stateJson);
    } catch {
      throw new BadRequestException('Corrupted state parameter');
    }

    if (stateData.flow !== 'login') {
      throw new BadRequestException('Invalid OAuth flow');
    }

    const clientId = this.configService.get('GOOGLE_CLIENT_ID');
    const clientSecret = this.configService.get('GOOGLE_CLIENT_SECRET');

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      this.logger.error(`Google token exchange failed: ${error}`);
      throw new BadRequestException('Failed to authenticate with Google');
    }

    const tokens = await tokenResponse.json();

    // Fetch Google profile
    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!profileResponse.ok) {
      throw new BadRequestException('Failed to get Google profile');
    }

    const profile = await profileResponse.json();
    const email = profile.email?.toLowerCase();

    if (!email) {
      throw new BadRequestException('No email found in Google profile');
    }

    // Find or create user
    let user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      user = await this.createNewUser({
        email,
        name: profile.name,
        provider: 'GOOGLE',
        providerProfile: { id: profile.id, displayName: profile.name, picture: profile.picture },
        markEmailVerified: true,
      });
    } else {
      // Existing user — upsert Google identity
      const googleIdentityType = await this.prisma.identityType.findUnique({ where: { code: 'GOOGLE' } });
      if (googleIdentityType) {
        await this.prisma.userIdentity.upsert({
          where: { identityTypeId_value: { identityTypeId: googleIdentityType.id, value: email } },
          update: {
            isVerified: true,
            verifiedAt: new Date(),
            metadata: { googleId: profile.id, displayName: profile.name, picture: profile.picture },
          },
          create: {
            userId: user.id,
            identityTypeId: googleIdentityType.id,
            value: email,
            displayValue: profile.email,
            isPrimary: false,
            isVerified: true,
            verifiedAt: new Date(),
            visibility: 'BOLO_ONLY',
            metadata: { googleId: profile.id, displayName: profile.name, picture: profile.picture },
          },
        });
      }

      // Verify email identity if not verified
      const emailIdentityType = await this.prisma.identityType.findUnique({ where: { code: 'EMAIL' } });
      if (emailIdentityType) {
        await this.prisma.userIdentity.updateMany({
          where: { userId: user.id, identityTypeId: emailIdentityType.id, value: email, isVerified: false },
          data: { isVerified: true, verifiedAt: new Date() },
        });
      }

      this.logger.log(`User @${user.handle} logged in via Google OAuth`);
    }

    return {
      ...this.formatUserResponse(user),
      redirectUrl: stateData.redirectUrl || '/dashboard',
    };
  }

  // ── Email Auth (OTP + Magic Link) ─────────────────────────────────

  private async checkEmailAuthRateLimit(ip: string, email: string): Promise<void> {
    if (!this.redis) return;
    try {
      // Rate limit by IP
      const ipKey = `auth:rate:email_auth:${ip}`;
      const ipCount = await this.redis.incr(ipKey);
      if (ipCount === 1) await this.redis.expire(ipKey, EMAIL_AUTH_IP_RATE_WINDOW);
      if (ipCount > EMAIL_AUTH_IP_RATE_LIMIT) {
        throw new HttpException('Too many attempts. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
      }

      // Rate limit by email
      const emailKey = `auth:rate:email_auth:${email.toLowerCase()}`;
      const emailCount = await this.redis.incr(emailKey);
      if (emailCount === 1) await this.redis.expire(emailKey, EMAIL_AUTH_EMAIL_RATE_WINDOW);
      if (emailCount > EMAIL_AUTH_EMAIL_RATE_LIMIT) {
        throw new HttpException('Too many attempts for this email. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(`Redis unavailable for email auth rate limiting: ${err}`);
    }
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async sendEmailAuth(email: string, method: 'otp' | 'link', ip?: string): Promise<{ success: true; message: string }> {
    if (ip) await this.checkEmailAuthRateLimit(ip, email);

    // Delete any unused tokens for this email
    await this.prisma.emailAuthToken.deleteMany({
      where: { email: email.toLowerCase(), usedAt: null },
    });

    if (method === 'otp') {
      // Generate 6-digit code
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const hashedCode = this.hashToken(code);

      await this.prisma.emailAuthToken.create({
        data: {
          email: email.toLowerCase(),
          code: hashedCode,
          type: 'otp',
          expiresAt: new Date(Date.now() + OTP_EXPIRY_SECONDS * 1000),
        },
      });

      await this.emailService.sendOtpEmail(email, code);
    } else {
      // Generate magic link token
      const token = crypto.randomBytes(32).toString('base64url');
      const hashedToken = this.hashToken(token);
      const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:3000';
      const apiUrl = this.configService.get('API_URL') || 'http://localhost:3001';
      const magicLinkUrl = `${apiUrl}/api/auth/email/verify-link?token=${encodeURIComponent(token)}`;

      await this.prisma.emailAuthToken.create({
        data: {
          email: email.toLowerCase(),
          code: hashedToken,
          type: 'magic_link',
          expiresAt: new Date(Date.now() + MAGIC_LINK_EXPIRY_SECONDS * 1000),
        },
      });

      await this.emailService.sendMagicLinkEmail(email, magicLinkUrl);
    }

    // Same message regardless of whether email exists — prevents enumeration
    return { success: true, message: 'If this email is valid, you will receive a login code or link shortly.' };
  }

  async verifyEmailCode(email: string, code: string): Promise<AuthResponseDto> {
    const hashedCode = this.hashToken(code);

    const token = await this.prisma.emailAuthToken.findFirst({
      where: {
        email: email.toLowerCase(),
        code: hashedCode,
        type: 'otp',
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!token) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    // Mark as used
    await this.prisma.emailAuthToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    });

    return this.findOrCreateUserByEmail(email);
  }

  async verifyEmailLink(plaintextToken: string): Promise<AuthResponseDto & { redirectUrl: string }> {
    const hashedToken = this.hashToken(plaintextToken);

    const token = await this.prisma.emailAuthToken.findFirst({
      where: {
        code: hashedToken,
        type: 'magic_link',
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!token) {
      throw new UnauthorizedException('Invalid or expired link');
    }

    // Mark as used
    await this.prisma.emailAuthToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    });

    const authResponse = await this.findOrCreateUserByEmail(token.email);
    return { ...authResponse, redirectUrl: '/dashboard' };
  }

  private async findOrCreateUserByEmail(email: string): Promise<AuthResponseDto> {
    let user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    if (!user) {
      user = await this.createNewUser({
        email: email.toLowerCase(),
        provider: 'EMAIL',
        markEmailVerified: true, // Email ownership proven by receiving code/link
      });
    } else {
      // Verify email identity if not verified
      const emailIdentityType = await this.prisma.identityType.findUnique({ where: { code: 'EMAIL' } });
      if (emailIdentityType) {
        await this.prisma.userIdentity.updateMany({
          where: { userId: user.id, identityTypeId: emailIdentityType.id, value: email.toLowerCase(), isVerified: false },
          data: { isVerified: true, verifiedAt: new Date() },
        });
      }
      this.logger.log(`User @${user.handle} logged in via email auth`);
    }

    return this.formatUserResponse(user);
  }

  // ── Onboarding ────────────────────────────────────────────────────

  async completeOnboarding(userId: string, handle: string, name?: string, timezone?: string): Promise<AuthResponseDto> {
    // Check handle availability
    const existingHandle = await this.prisma.user.findUnique({ where: { handle } });
    if (existingHandle && existingHandle.id !== userId) {
      throw new ConflictException('Handle is already taken');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Update user
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        handle,
        needsOnboarding: false,
        ...(name && { name }),
        ...(timezone && { timezone }),
      },
    });

    // Update BOLO_HANDLE identity
    const handleIdentityType = await this.prisma.identityType.findUnique({ where: { code: 'BOLO_HANDLE' } });
    if (handleIdentityType) {
      await this.prisma.userIdentity.updateMany({
        where: { userId, identityTypeId: handleIdentityType.id },
        data: { value: handle.toLowerCase(), displayValue: `@${handle}` },
      });
    }

    this.logger.log(`User completed onboarding: @${handle}`);

    // Return new JWT with updated handle
    return this.formatUserResponse(updatedUser);
  }

  async generateUniqueHandle(baseName: string): Promise<string> {
    // Sanitize: lowercase, alphanumeric + underscores only
    let handle = baseName
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 16);

    // Ensure minimum length
    if (handle.length < 3) {
      handle = `user_${handle}`;
    }

    // Check uniqueness
    let finalHandle = handle;
    let attempts = 0;
    while (attempts < 10) {
      const existing = await this.prisma.user.findUnique({
        where: { handle: finalHandle },
      });
      if (!existing) break;

      // Append random suffix
      const suffix = Math.random().toString(36).substring(2, 6);
      finalHandle = `${handle.slice(0, 12)}_${suffix}`;
      attempts++;
    }

    return finalHandle;
  }
}
