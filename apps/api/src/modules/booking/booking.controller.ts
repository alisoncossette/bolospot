import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Res,
  Request,
  UseGuards,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { DateTime } from 'luxon';
import { BookingService } from './booking.service';
import { VisitorOAuthService } from './visitor-oauth.service';
import { GrantsService } from '../grants/grants.service';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { OptionalSessionAuthGuard } from '../auth/guards/optional-session-auth.guard';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UsageService } from '../billing/usage.service';

@ApiTags('booking')
@Controller('booking')
export class BookingController {
  constructor(
    private bookingService: BookingService,
    private visitorOAuthService: VisitorOAuthService,
    private grantsService: GrantsService,
    private usageService: UsageService,
  ) {}

  @Get(':handle/profiles')
  @ApiOperation({ summary: 'List public booking profiles', description: 'Get all active public booking profiles for a user (no auth required)' })
  @ApiParam({ name: 'handle', description: 'User handle' })
  @ApiResponse({ status: 200, description: 'Profiles returned' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async listProfiles(@Param('handle') handle: string) {
    return this.bookingService.listPublicProfiles(handle);
  }

  @Get(':handle/profile')
  @ApiOperation({ summary: 'Get public booking profile', description: 'Get a user\'s public profile and booking settings (no auth required)' })
  @ApiParam({ name: 'handle', description: 'User handle' })
  @ApiQuery({ name: 'profileSlug', required: false, description: 'Specific profile slug (default: first active profile)' })
  @ApiResponse({ status: 200, description: 'Profile returned' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getProfile(
    @Param('handle') handle: string,
    @Query('profileSlug') profileSlug?: string,
  ) {
    return this.bookingService.getPublicProfile(handle, profileSlug);
  }

  @Post(':handle/validate-handle')
  @ApiOperation({ summary: 'Validate a Bolo handle', description: 'Check if a handle exists and has a public booking profile' })
  @ApiParam({ name: 'handle', description: 'Host handle (context)' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['handle'],
      properties: {
        handle: { type: 'string', description: '@handle to validate' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Validation result returned' })
  async validateHandle(
    @Body('handle') handleToValidate: string,
  ) {
    if (!handleToValidate) {
      throw new BadRequestException('handle is required');
    }
    return this.bookingService.validateHandle(handleToValidate);
  }

  @Post(':handle/resolve-email')
  @ApiOperation({ summary: 'Resolve email to Bolo user', description: 'Check if an email belongs to a Bolo user with a public booking profile' })
  @ApiParam({ name: 'handle', description: 'Host handle (context)' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email'],
      properties: {
        email: { type: 'string', format: 'email', description: 'Email to resolve' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Resolution result returned' })
  async resolveEmail(
    @Param('handle') handle: string,
    @Body('email') email: string,
  ) {
    if (!email) {
      throw new BadRequestException('email is required');
    }
    return this.bookingService.resolveEmail(handle, email);
  }

  @Get(':handle/slots')
  @ApiOperation({ summary: 'Get available time slots', description: 'Get available booking slots for a specific date. Optionally include additional Bolo handles for multi-party availability.' })
  @ApiParam({ name: 'handle', description: 'User handle' })
  @ApiQuery({ name: 'date', required: true, description: 'Date (YYYY-MM-DD)' })
  @ApiQuery({ name: 'duration', required: true, description: 'Meeting duration in minutes' })
  @ApiQuery({ name: 'timezone', required: false, description: 'Visitor timezone (default: host timezone)' })
  @ApiQuery({ name: 'additionalHandles', required: false, description: 'Comma-separated additional @handles for multi-party availability' })
  @ApiQuery({ name: 'visitorSessionId', required: false, description: 'Visitor OAuth session ID for calendar integration' })
  @ApiQuery({ name: 'profileSlug', required: false, description: 'Specific booking profile slug for per-calendar availability' })
  @ApiResponse({ status: 200, description: 'Available slots returned' })
  async getSlots(
    @Param('handle') handle: string,
    @Query('date') date: string,
    @Query('duration') duration: string,
    @Query('timezone') timezone?: string,
    @Query('additionalHandles') additionalHandles?: string,
    @Query('visitorSessionId') visitorSessionId?: string,
    @Query('profileSlug') profileSlug?: string,
  ) {
    if (!date) {
      throw new BadRequestException('date is required (YYYY-MM-DD)');
    }
    if (!duration) {
      throw new BadRequestException('duration is required (minutes)');
    }

    // Resolve connectionId from profile slug
    let connectionId: string | undefined;
    if (profileSlug) {
      const profileData = await this.bookingService.getPublicProfile(handle, profileSlug);
      connectionId = profileData?.bookingProfile?.connectionId || undefined;
    }

    // Parse comma-separated handles
    const handles = additionalHandles
      ? additionalHandles.split(',').map(h => h.trim()).filter(Boolean)
      : undefined;

    // Fetch visitor's busy periods if they connected their calendar
    let visitorBusyPeriods: { startTime: Date; endTime: Date; source: string }[] | undefined;
    if (visitorSessionId) {
      const tz = timezone || 'UTC';
      const dayStart = DateTime.fromISO(date, { zone: tz }).startOf('day').toJSDate();
      const dayEnd = DateTime.fromISO(date, { zone: tz }).endOf('day').toJSDate();
      visitorBusyPeriods = await this.visitorOAuthService.getVisitorBusyPeriods(
        visitorSessionId,
        dayStart,
        dayEnd,
      );
    }

    return this.bookingService.getAvailableSlots(
      handle,
      date,
      parseInt(duration, 10),
      timezone,
      handles,
      visitorBusyPeriods,
      connectionId,
    );
  }

  @Get(':handle/access')
  @UseGuards(OptionalSessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Check booking access level', description: 'Returns what booking tier the visitor gets for this host. Works with or without auth.' })
  @ApiParam({ name: 'handle', description: 'Host handle' })
  @ApiResponse({ status: 200, description: 'Access tier returned' })
  async checkBookingAccess(
    @Param('handle') handle: string,
    @Request() req: any,
  ) {
    const visitorHandle = req.user?.handle || null;
    return this.grantsService.resolveBookingAccess(handle, visitorHandle);
  }

  // ─── Visitor OAuth ────────────────────────────────────
  // IMPORTANT: callback must be declared BEFORE :provider to avoid NestJS matching "callback" as a provider param

  @Get('visitor-auth/callback')
  @ApiOperation({ summary: 'Visitor OAuth callback', description: 'Handles OAuth callback, stores ephemeral token, redirects to booking page' })
  @ApiResponse({ status: 302, description: 'Redirects back to booking page with session info' })
  async visitorOAuthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    if (!code || !state) {
      throw new BadRequestException('Missing code or state parameter');
    }

    const { redirectUrl } = await this.visitorOAuthService.handleCallback(code, state);
    res.redirect(redirectUrl);
  }

  @Get('visitor-auth/:provider')
  @ApiOperation({ summary: 'Start visitor OAuth', description: 'Redirect visitor to Google/Microsoft OAuth for read-only calendar access' })
  @ApiParam({ name: 'provider', enum: ['google', 'microsoft'] })
  @ApiQuery({ name: 'hostHandle', required: true })
  @ApiQuery({ name: 'redirectUrl', required: true, description: 'URL to redirect back to after OAuth' })
  @ApiResponse({ status: 302, description: 'Redirects to OAuth provider' })
  async startVisitorOAuth(
    @Param('provider') provider: string,
    @Query('hostHandle') hostHandle: string,
    @Query('redirectUrl') redirectUrl: string,
    @Res() res: Response,
  ) {
    if (!['google', 'microsoft'].includes(provider)) {
      throw new BadRequestException('Provider must be "google" or "microsoft"');
    }
    if (!hostHandle || !redirectUrl) {
      throw new BadRequestException('hostHandle and redirectUrl are required');
    }

    const { authUrl } = await this.visitorOAuthService.startOAuth(
      provider as 'google' | 'microsoft',
      hostHandle,
      redirectUrl,
    );

    res.redirect(authUrl);
  }

  @Post('visitor-auth/destroy')
  @ApiOperation({ summary: 'Destroy visitor session', description: 'Clean up visitor OAuth session' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['sessionId'],
      properties: {
        sessionId: { type: 'string' },
      },
    },
  })
  async destroyVisitorSession(@Body('sessionId') sessionId: string) {
    if (!sessionId) {
      throw new BadRequestException('sessionId is required');
    }
    await this.visitorOAuthService.destroySession(sessionId);
    return { success: true };
  }

  // ─── Owner Access Management (Doorstep) ─────────────

  @Get(':handle/contacts')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List contacts with tiers', description: 'Owner-only: list all contacts with resolved booking tiers' })
  @ApiParam({ name: 'handle', description: 'Your handle' })
  @ApiResponse({ status: 200, description: 'Contact list returned' })
  async listContactTiers(
    @Param('handle') handle: string,
    @Request() req: any,
  ) {
    const userHandle = await this.grantsService.getUserHandle(req.user.id);
    if (!userHandle || userHandle.toLowerCase() !== handle.toLowerCase()) {
      throw new ForbiddenException('You can only view your own contacts');
    }
    return this.grantsService.listContactsWithTiers(req.user.id);
  }

  @Patch(':handle/set-tier')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set contact booking tier', description: 'Owner-only: set direct/approval/blocked for a contact by handle or email' })
  @ApiParam({ name: 'handle', description: 'Your handle' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        contactHandle: { type: 'string', description: '@handle of the contact' },
        contactEmail: { type: 'string', format: 'email', description: 'Email of the contact' },
        tier: { type: 'string', enum: ['direct', 'approval', 'blocked'] },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Tier updated' })
  async setContactTier(
    @Param('handle') handle: string,
    @Request() req: any,
    @Body() body: { contactHandle?: string; contactEmail?: string; tier: 'direct' | 'approval' | 'blocked' },
  ) {
    const userId = req.user.id;
    const userHandle = await this.grantsService.getUserHandle(userId);
    if (!userHandle || userHandle.toLowerCase() !== handle.toLowerCase()) {
      throw new ForbiddenException('You can only manage your own contacts');
    }
    if (!body.contactHandle && !body.contactEmail) {
      throw new BadRequestException('contactHandle or contactEmail is required');
    }
    if (!['direct', 'approval', 'blocked'].includes(body.tier)) {
      throw new BadRequestException('tier must be direct, approval, or blocked');
    }
    return this.grantsService.setBookingTier(userId, body.contactHandle, body.contactEmail, body.tier);
  }

  @Patch(':handle/default-tier')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set default booking tier', description: 'Owner-only: set the default tier for unknown visitors' })
  @ApiParam({ name: 'handle', description: 'Your handle' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['autoApprove'],
      properties: {
        autoApprove: { type: 'boolean', description: 'true = unknown visitors can book directly, false = they need approval' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Default tier updated' })
  async setDefaultTier(
    @Param('handle') handle: string,
    @Request() req: any,
    @Body() body: { autoApprove: boolean },
  ) {
    const userId = req.user.id;
    const userHandle = await this.grantsService.getUserHandle(userId);
    if (!userHandle || userHandle.toLowerCase() !== handle.toLowerCase()) {
      throw new ForbiddenException('You can only manage your own settings');
    }
    await this.grantsService.setDefaultBookingTier(userId, body.autoApprove);
    return { success: true, autoApprove: body.autoApprove };
  }

  @Post(':handle/book')
  @UseGuards(OptionalSessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Book a meeting', description: 'Book a time slot with a user. Booking tier (direct/approval) is resolved from the visitor\'s grant level.' })
  @ApiParam({ name: 'handle', description: 'User handle' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['startTime', 'duration', 'timezone', 'name', 'email'],
      properties: {
        startTime: { type: 'string', format: 'date-time', description: 'ISO datetime of chosen slot' },
        duration: { type: 'number', description: 'Duration in minutes' },
        timezone: { type: 'string', description: 'Visitor timezone' },
        name: { type: 'string', description: 'Visitor name' },
        email: { type: 'string', format: 'email', description: 'Visitor email' },
        notes: { type: 'string', description: 'Optional notes' },
        additionalAttendees: { type: 'array', items: { type: 'string', format: 'email' }, description: 'Additional attendee emails' },
        additionalHandles: { type: 'array', items: { type: 'string' }, description: 'Additional Bolo @handles to include in the meeting' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Booking confirmed or request submitted' })
  @ApiResponse({ status: 400, description: 'Slot unavailable or invalid' })
  async book(
    @Param('handle') handle: string,
    @Body() dto: CreateBookingDto,
    @Request() req: any,
  ) {
    if (!dto.startTime || !dto.duration || !dto.timezone || !dto.name || !dto.email) {
      throw new BadRequestException('startTime, duration, timezone, name, and email are required');
    }

    // Resolve booking tier from visitor's grant level
    const visitorHandle = req.user?.handle || null;
    const { tier } = await this.grantsService.resolveBookingAccess(handle, visitorHandle);

    if (tier === 'blocked') {
      throw new BadRequestException('Booking is not available for this host');
    }

    const result = await this.bookingService.createBooking(handle, dto, tier, visitorHandle);

    // Track booking for transaction fee billing (via API key owner)
    if (req.apiKeyUser?.id) {
      this.usageService.increment(req.apiKeyUser.id, 'booking').catch(() => {});
    }

    return result;
  }
}
