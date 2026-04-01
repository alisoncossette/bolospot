import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  Request,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiParam, ApiSecurity } from '@nestjs/swagger';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { ApiKeyGuard } from '../api-keys/api-key.guard';
import { ApiKeyThrottleGuard } from '../api-keys/api-key-throttle.guard';
import { RateLimit } from '../api-keys/api-key-throttle.guard';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { GrantsService } from '../grants/grants.service';
import { ConnectionsService } from '../connections/connections.service';
import { EventsService, UnifiedEventsResponse } from './events.service';
import { UpdateEventDto } from './dto/events.dto';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(
    private eventsService: EventsService,
    private apiKeysService: ApiKeysService,
    private grantsService: GrantsService,
    private connectionsService: ConnectionsService,
  ) {}

  @Get('my')
  @UseGuards(ApiKeyGuard, ApiKeyThrottleGuard)
  @RateLimit(30, 60)
  @ApiSecurity('api_key')
  @ApiOperation({ summary: 'Get your calendar events via API key', description: 'Fetch events from all your connected calendars within a date range. Authenticated via API key.' })
  @ApiQuery({ name: 'startDate', required: true, description: 'Start date (ISO 8601)', example: '2024-01-01T00:00:00Z' })
  @ApiQuery({ name: 'endDate', required: true, description: 'End date (ISO 8601)', example: '2024-01-31T23:59:59Z' })
  @ApiResponse({ status: 200, description: 'Events returned from all connected calendars' })
  @ApiResponse({ status: 400, description: 'Invalid date format or range exceeds 90 days' })
  @ApiResponse({ status: 401, description: 'Invalid API key' })
  async getMyEvents(
    @Request() req: any,
    @Query('startDate') startDateStr: string,
    @Query('endDate') endDateStr: string,
  ): Promise<UnifiedEventsResponse> {
    if (!req.apiKeyUser?.id) {
      throw new BadRequestException('API key must belong to a user.');
    }
    const ownerId = req.apiKeyUser.id;

    if (!startDateStr || !endDateStr) {
      throw new BadRequestException('startDate and endDate are required');
    }

    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new BadRequestException('Invalid date format. Use ISO 8601 format.');
    }

    if (startDate >= endDate) {
      throw new BadRequestException('startDate must be before endDate');
    }

    const maxRangeMs = 90 * 24 * 60 * 60 * 1000;
    if (endDate.getTime() - startDate.getTime() > maxRangeMs) {
      throw new BadRequestException('Date range cannot exceed 90 days');
    }

    return this.eventsService.getUnifiedEvents(ownerId, startDate, endDate);
  }

  @Get(':handle/key')
  @UseGuards(ApiKeyGuard, ApiKeyThrottleGuard)
  @RateLimit(20, 60)
  @ApiSecurity('api-key')
  @ApiOperation({
    summary: 'List calendar events for a handle (API key)',
    description: 'Get calendar event titles and times for a user by handle. Requires a valid API key AND a Bolo grant from the target with calendar:events:read scope. Private events show as "Private event" with times only. Descriptions, attendees, and locations are not included.',
  })
  @ApiParam({ name: 'handle', description: 'Target user handle (e.g., "sarah" or "@sarah")' })
  @ApiQuery({ name: 'startDate', required: true, description: 'Start date (YYYY-MM-DD or ISO 8601)' })
  @ApiQuery({ name: 'endDate', required: true, description: 'End date (YYYY-MM-DD or ISO 8601)' })
  @ApiQuery({ name: 'timezone', required: false, description: 'Timezone for date interpretation (default: UTC)' })
  @ApiResponse({ status: 200, description: 'Events returned (titles and times only)' })
  @ApiResponse({ status: 403, description: 'Forbidden - no events:read grant from target' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async listEventsByHandle(
    @Request() req: any,
    @Param('handle') handle: string,
    @Query('startDate') startDateStr: string,
    @Query('endDate') endDateStr: string,
    @Query('timezone') timezone?: string,
  ) {
    // API key must have availability:read permission (events are a superset of availability)
    if (!this.apiKeysService.hasPermission(req.apiKey.permissions, 'availability:read')) {
      throw new ForbiddenException('API key does not have availability:read permission');
    }

    // Must have a @handle identity
    if (!req.apiKeyUser?.handle) {
      throw new ForbiddenException(
        'Cannot determine your identity. API key must belong to a user with a @handle.',
      );
    }

    // Must have a connected calendar (proof of real account)
    const hasCalendar = await this.connectionsService.hasConnectedCalendar(req.apiKeyUser.id);
    if (!hasCalendar) {
      throw new ForbiddenException(
        'You must connect at least one calendar to use the events API. ' +
        'Visit https://bolospot.com/dashboard/connections to connect Google or Microsoft.',
      );
    }

    // MANDATORY: target must have granted calendar:events:read to the API key owner
    const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle;
    const hasGrant = await this.grantsService.hasAccess(
      req.apiKeyUser.handle,
      cleanHandle,
      'calendar',
      'events:read',
    );

    if (!hasGrant) {
      throw new ForbiddenException(
        `@${cleanHandle} has not granted you calendar:events:read access. ` +
        `Request it: bolo request @${cleanHandle} calendar:events:read`,
      );
    }

    // Validate dates
    if (!startDateStr || !endDateStr) {
      throw new BadRequestException('startDate and endDate are required');
    }

    // Support YYYY-MM-DD by converting to full ISO dates
    const startDate = startDateStr.length === 10
      ? new Date(`${startDateStr}T00:00:00${timezone ? '' : 'Z'}`)
      : new Date(startDateStr);
    const endDate = endDateStr.length === 10
      ? new Date(`${endDateStr}T23:59:59${timezone ? '' : 'Z'}`)
      : new Date(endDateStr);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new BadRequestException('Invalid date format. Use YYYY-MM-DD or ISO 8601 format.');
    }

    if (startDate >= endDate) {
      throw new BadRequestException('startDate must be before endDate');
    }

    // Max 30-day range for events (tighter than the 90-day limit on own events)
    const maxRangeMs = 30 * 24 * 60 * 60 * 1000;
    if (endDate.getTime() - startDate.getTime() > maxRangeMs) {
      throw new BadRequestException('Date range cannot exceed 30 days for listing events.');
    }

    try {
      const result = await this.eventsService.getEventsByHandle(cleanHandle, startDate, endDate);
      return {
        handle: `@${result.handle}`,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        eventCount: result.events.length,
        events: result.events,
      };
    } catch (err) {
      if (err.message === 'User not found') {
        throw new NotFoundException(`User @${cleanHandle} not found`);
      }
      throw err;
    }
  }

  @Get('handle/:handle')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get events for a handle (session)', description: 'Get calendar events for another user by handle. Requires events:read grant from target.' })
  @ApiParam({ name: 'handle', description: 'Target user handle' })
  @ApiQuery({ name: 'startDate', required: true })
  @ApiQuery({ name: 'endDate', required: true })
  @ApiResponse({ status: 200, description: 'Events returned' })
  @ApiResponse({ status: 403, description: 'No events:read grant' })
  async getEventsByHandleSession(
    @Request() req: any,
    @Param('handle') handle: string,
    @Query('startDate') startDateStr: string,
    @Query('endDate') endDateStr: string,
  ) {
    const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle;

    // Look up the requesting user's handle
    const user = await this.eventsService['prisma'].user.findUnique({
      where: { id: req.user.id },
      select: { handle: true },
    });

    if (!user?.handle) {
      throw new ForbiddenException('You need a @handle to view other users\' events.');
    }

    // Check grant
    const hasGrant = await this.grantsService.hasAccess(
      user.handle,
      cleanHandle,
      'calendar',
      'events:read',
    );

    if (!hasGrant) {
      throw new ForbiddenException(
        `@${cleanHandle} has not granted you calendar:events:read access.`,
      );
    }

    if (!startDateStr || !endDateStr) {
      throw new BadRequestException('startDate and endDate are required');
    }

    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    const result = await this.eventsService.getEventsByHandle(cleanHandle, startDate, endDate);
    return {
      handle: `@${result.handle}`,
      eventCount: result.events.length,
      events: result.events,
    };
  }

  @Get()
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get unified calendar events', description: 'Fetch events from all connected calendars within a date range' })
  @ApiQuery({ name: 'startDate', required: true, description: 'Start date (ISO 8601)', example: '2024-01-01T00:00:00Z' })
  @ApiQuery({ name: 'endDate', required: true, description: 'End date (ISO 8601)', example: '2024-01-31T23:59:59Z' })
  @ApiResponse({ status: 200, description: 'Events returned from all connected calendars' })
  @ApiResponse({ status: 400, description: 'Invalid date format or range exceeds 90 days' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getEvents(
    @Request() req: any,
    @Query('startDate') startDateStr: string,
    @Query('endDate') endDateStr: string,
  ): Promise<UnifiedEventsResponse> {
    if (!startDateStr || !endDateStr) {
      throw new BadRequestException('startDate and endDate are required');
    }

    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new BadRequestException('Invalid date format. Use ISO 8601 format.');
    }

    if (startDate >= endDate) {
      throw new BadRequestException('startDate must be before endDate');
    }

    const maxRangeMs = 90 * 24 * 60 * 60 * 1000;
    if (endDate.getTime() - startDate.getTime() > maxRangeMs) {
      throw new BadRequestException('Date range cannot exceed 90 days');
    }

    return this.eventsService.getUnifiedEvents(req.user.id, startDate, endDate);
  }

  @Patch(':eventId')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Move/update a calendar event', description: 'Update the start and end time of an event on the external calendar provider' })
  @ApiResponse({ status: 200, description: 'Event updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid parameters' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async updateEvent(
    @Request() req: any,
    @Param('eventId') eventId: string,
    @Body() body: UpdateEventDto,
  ) {
    const startTime = new Date(body.startTime);
    const endTime = new Date(body.endTime);

    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    if (startTime >= endTime) {
      throw new BadRequestException('startTime must be before endTime');
    }

    return this.eventsService.updateEvent(
      req.user.id,
      body.calendarId,
      eventId,
      startTime,
      endTime,
    );
  }
}
