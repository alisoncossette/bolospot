import { Controller, Get, Post, Query, Body, Req, Res, UseGuards, ForbiddenException, UnauthorizedException, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { GrantsService } from '../grants/grants.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import Redis from 'ioredis';
import * as crypto from 'crypto';

const MAGIC_LINK_DEFAULT_TTL_HOURS = 72;

@Controller('internal-access')
export class InternalAccessController {
  constructor(
    private grantsService: GrantsService,
    private configService: ConfigService,
    @Optional() @Inject(REDIS_CLIENT) private redis: Redis | null,
  ) {}

  @Get('check')
  @UseGuards(SessionAuthGuard)
  async checkAccess(
    @Req() req: any,
    @Query('scope') scope: string,
  ) {
    if (!scope) {
      throw new ForbiddenException('scope query parameter is required');
    }

    const myHandle = await this.grantsService.getUserHandle(req.user.id);
    if (!myHandle) {
      return { hasAccess: false };
    }

    // Owner always has access to their own internal pages
    if (myHandle === 'bolo') {
      return { hasAccess: true };
    }

    // Check if @bolo has granted this user access to bolo_internal with the requested scope
    const hasAccess = await this.grantsService.hasAccess(
      myHandle,
      'bolo',
      'bolo_internal',
      scope,
    );

    return { hasAccess };
  }

  // ── Magic Links ────────────────────────────────────────────────────

  @Post('magic-link')
  @UseGuards(SessionAuthGuard)
  async generateMagicLink(
    @Req() req: any,
    @Body() body: { scope: string; expiresInHours?: number },
  ) {
    if (!this.redis) {
      throw new ForbiddenException('Magic links require Redis');
    }

    // Only @bolo can generate magic links
    const myHandle = await this.grantsService.getUserHandle(req.user.id);
    if (myHandle !== 'bolo') {
      throw new ForbiddenException('Only @bolo can generate magic links');
    }

    const scope = body.scope || 'lfg';
    const ttlHours = body.expiresInHours || MAGIC_LINK_DEFAULT_TTL_HOURS;
    const ttlSeconds = ttlHours * 3600;

    const token = crypto.randomBytes(32).toString('base64url');
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    await this.redis.set(
      `magic_link:${hashedToken}`,
      JSON.stringify({
        scope,
        createdBy: req.user.id,
        createdAt: Date.now(),
      }),
      'EX',
      ttlSeconds,
    );

    const frontendUrl = this.configService.get('FRONTEND_URL') || 'https://bolospot.com';
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    return {
      url: `${frontendUrl}/lfg?access=${token}`,
      expiresAt,
      ttlHours,
    };
  }

  @Get('verify-magic-link')
  async verifyMagicLink(
    @Query('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!this.redis || !token) {
      throw new UnauthorizedException('Invalid or expired link');
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const data = await this.redis.get(`magic_link:${hashedToken}`);

    if (!data) {
      throw new UnauthorizedException('Invalid or expired link');
    }

    const { scope } = JSON.parse(data);
    const isProduction = this.configService.get('NODE_ENV') === 'production';

    // Set a scoped access cookie — NOT a full session, just LFG access
    res.cookie('bolo_lfg_access', scope, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      domain: isProduction ? '.bolospot.com' : undefined,
      path: '/',
      maxAge: 72 * 60 * 60 * 1000, // 72 hours
    });

    return { success: true, scope };
  }

  /**
   * Check access via magic link cookie (no auth required).
   * Used by the /lfg layout when user has no session but may have a magic link cookie.
   */
  @Get('check-magic')
  async checkMagicAccess(
    @Req() req: any,
    @Query('scope') scope: string,
  ) {
    const magicScope = req.cookies?.['bolo_lfg_access'];
    if (!magicScope || !scope) {
      return { hasAccess: false };
    }

    // The cookie value is the scope that was granted
    // 'lfg' grants lfg, 'docs' grants docs, etc.
    const hasAccess = magicScope === scope || magicScope === '*';
    return { hasAccess };
  }
}
