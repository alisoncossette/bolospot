import { Controller, Post, Body, Get, UseGuards, Request, Query, Ip, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { setSessionCookie, clearSessionCookie } from './cookie.helper';
import { RegisterDto, LoginDto, EmailAuthSendDto, EmailAuthVerifyDto, OnboardingDto, AuthResponseDto } from './dto/auth.dto';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { Request as ExpressRequest } from 'express';

interface AuthenticatedRequest extends ExpressRequest {
  user: {
    id: string;
    email: string;
    handle: string;
    name?: string;
    timezone: string;
    verificationLevel: string;
    isHumanVerified: boolean;
    betaAccess: boolean;
    isSuperAdmin: boolean;
    needsOnboarding: boolean;
  };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly isProduction: boolean;

  constructor(
    private authService: AuthService,
    private sessionService: SessionService,
    private configService: ConfigService,
  ) {
    this.isProduction = configService.get('NODE_ENV') === 'production';
  }

  private async createSessionAndSetCookie(user: any, res: Response): Promise<string> {
    const sessionId = await this.sessionService.createSession(user.id, {
      userId: user.id,
      email: user.email,
      handle: user.handle,
    });
    setSessionCookie(res, sessionId, this.isProduction);
    return sessionId;
  }

  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User registered successfully', type: AuthResponseDto })
  async register(
    @Body() dto: RegisterDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const result = await this.authService.register(dto, ip);
    await this.createSessionAndSetCookie(result.user, res);
    return result; // Still returns accessToken during transition
  }

  @Post('login')
  @ApiOperation({ summary: 'Login user' })
  @ApiResponse({ status: 200, description: 'Login successful', type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 429, description: 'Too many attempts' })
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const result = await this.authService.login(dto, ip);
    await this.createSessionAndSetCookie(result.user, res);
    return result;
  }

  @Post('quick-login')
  @ApiOperation({ summary: 'Quick login by email — finds existing user, returns token' })
  async quickLogin(
    @Body() body: { email: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.quickLogin(body.email);
    const sessionId = await this.createSessionAndSetCookie(result.user, res);
    return { ...result, sessionId };
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user' })
  @ApiResponse({ status: 200, description: 'User profile returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async me(@Request() req: AuthenticatedRequest) {
    return {
      id: req.user.id,
      email: req.user.email,
      handle: req.user.handle,
      name: req.user.name,
      timezone: req.user.timezone,
      verificationLevel: req.user.verificationLevel,
      isHumanVerified: req.user.isHumanVerified,
      betaAccess: req.user.betaAccess,
      isSuperAdmin: req.user.isSuperAdmin,
      needsOnboarding: req.user.needsOnboarding,
      plan: (req.user as any).plan || 'FREE',
    };
  }

  // ── Logout ──────────────────────────────────────────────────────────

  @Post('logout')
  @UseGuards(SessionAuthGuard)
  @ApiOperation({ summary: 'Logout', description: 'Destroy current session' })
  @ApiResponse({ status: 200, description: 'Logged out' })
  async logout(
    @Request() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const sessionId = req.cookies?.['bolo_session'];
    if (sessionId) {
      await this.sessionService.destroySession(sessionId);
    }
    clearSessionCookie(res, this.isProduction);
    return { success: true };
  }

  @Post('logout-all')
  @UseGuards(SessionAuthGuard)
  @ApiOperation({ summary: 'Logout everywhere', description: 'Destroy all sessions for this user' })
  @ApiResponse({ status: 200, description: 'All sessions destroyed' })
  async logoutAll(
    @Request() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.sessionService.destroyAllUserSessions(req.user.id);
    clearSessionCookie(res, this.isProduction);
    return { success: true };
  }

  // ── Microsoft OAuth ─────────────────────────────────────────────────

  @Get('microsoft/authorize')
  @ApiOperation({ summary: 'Start Microsoft OAuth' })
  @ApiResponse({ status: 302, description: 'Redirects to Microsoft OAuth' })
  async microsoftSocialAuthorize(
    @Query('redirectUrl') redirectUrl: string,
    @Res() res: Response,
  ) {
    const redirectUri = `${this.configService.get('API_URL')}/api/auth/microsoft/callback`;
    const result = await this.authService.getMicrosoftSocialAuthUrl(redirectUri, redirectUrl);
    res.redirect(result.url);
  }

  @Get('microsoft/callback')
  @ApiOperation({ summary: 'Microsoft OAuth callback' })
  @ApiResponse({ status: 302, description: 'Redirects to frontend with session cookie' })
  async microsoftSocialCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
  ) {
    const frontendUrl = this.configService.get('FRONTEND_URL');

    if (error) {
      const errorMsg = encodeURIComponent(errorDescription || error);
      return res.redirect(`${frontendUrl}/login?error=${errorMsg}`);
    }

    try {
      const redirectUri = `${this.configService.get('API_URL')}/api/auth/microsoft/callback`;
      const result = await this.authService.handleMicrosoftSocialCallback(code, redirectUri, state);

      // Set session cookie BEFORE redirect
      await this.createSessionAndSetCookie(result.user, res);

      const redirectPath = encodeURIComponent(result.redirectUrl);
      return res.redirect(`${frontendUrl}/auth/callback?redirect=${redirectPath}`);
    } catch (err) {
      const errorMsg = encodeURIComponent(
        err instanceof Error ? err.message : 'Authentication failed',
      );
      return res.redirect(`${frontendUrl}/login?error=${errorMsg}`);
    }
  }

  // ── Google OAuth ──────────────────────────────────────────────────

  @Get('google/authorize')
  @ApiOperation({ summary: 'Start Google OAuth' })
  @ApiResponse({ status: 302, description: 'Redirects to Google OAuth' })
  async googleSocialAuthorize(
    @Query('redirectUrl') redirectUrl: string,
    @Res() res: Response,
  ) {
    const redirectUri = `${this.configService.get('API_URL')}/api/auth/google/callback`;
    const result = await this.authService.getGoogleSocialAuthUrl(redirectUri, redirectUrl);
    res.redirect(result.url);
  }

  @Get('google/callback')
  @ApiOperation({ summary: 'Google OAuth callback' })
  @ApiResponse({ status: 302, description: 'Redirects to frontend with session cookie' })
  async googleSocialCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
  ) {
    const frontendUrl = this.configService.get('FRONTEND_URL');

    if (error) {
      const errorMsg = encodeURIComponent(errorDescription || error);
      return res.redirect(`${frontendUrl}/login?error=${errorMsg}`);
    }

    try {
      const redirectUri = `${this.configService.get('API_URL')}/api/auth/google/callback`;
      const result = await this.authService.handleGoogleSocialCallback(code, redirectUri, state);

      // Set session cookie AND pass session as query param (cross-domain fallback)
      const sessionId = await this.createSessionAndSetCookie(result.user, res);

      const redirectPath = encodeURIComponent(result.redirectUrl);
      return res.redirect(`${frontendUrl}/auth/callback?redirect=${redirectPath}&session=${sessionId}`);
    } catch (err) {
      const errorMsg = encodeURIComponent(
        err instanceof Error ? err.message : 'Authentication failed',
      );
      return res.redirect(`${frontendUrl}/login?error=${errorMsg}`);
    }
  }

  // ── Email Auth (OTP + Magic Link) ─────────────────────────────────

  @Post('email/send')
  @ApiOperation({ summary: 'Send login code or link' })
  @ApiResponse({ status: 200, description: 'Code/link sent (if email is valid)' })
  @ApiResponse({ status: 429, description: 'Too many attempts' })
  async sendEmailAuth(@Body() dto: EmailAuthSendDto, @Ip() ip: string) {
    return this.authService.sendEmailAuth(dto.email, dto.method, ip);
  }

  @Post('email/verify-code')
  @ApiOperation({ summary: 'Verify OTP code' })
  @ApiResponse({ status: 200, description: 'Authentication successful', type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid or expired code' })
  async verifyEmailCode(
    @Body() dto: EmailAuthVerifyDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const result = await this.authService.verifyEmailCode(dto.email, dto.code);
    await this.createSessionAndSetCookie(result.user, res);
    return result;
  }

  @Get('email/verify-link')
  @ApiOperation({ summary: 'Verify magic link' })
  @ApiResponse({ status: 302, description: 'Redirects to frontend with session cookie' })
  async verifyEmailLink(
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    const frontendUrl = this.configService.get('FRONTEND_URL');

    try {
      const result = await this.authService.verifyEmailLink(token);

      // Set session cookie BEFORE redirect
      await this.createSessionAndSetCookie(result.user, res);

      const redirectPath = encodeURIComponent(result.redirectUrl);
      return res.redirect(`${frontendUrl}/auth/callback?redirect=${redirectPath}`);
    } catch (err) {
      return res.redirect(`${frontendUrl}/login?error=magic_link_expired`);
    }
  }

  // ── Onboarding ────────────────────────────────────────────────────

  @Post('onboarding')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Complete onboarding' })
  @ApiResponse({ status: 200, description: 'Onboarding complete', type: AuthResponseDto })
  @ApiResponse({ status: 409, description: 'Handle already taken' })
  async completeOnboarding(
    @Request() req: AuthenticatedRequest,
    @Body() dto: OnboardingDto,
  ): Promise<AuthResponseDto> {
    return this.authService.completeOnboarding(req.user.id, dto.handle, dto.name, dto.timezone);
  }
}
