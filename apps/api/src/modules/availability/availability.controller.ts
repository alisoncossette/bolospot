import {
  Controller,
  Get,
  Query,
  Param,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiSecurity, ApiBearerAuth } from '@nestjs/swagger';
import { AvailabilityService } from './availability.service';
import { ApiKeyGuard } from '../api-keys/api-key.guard';
import { ApiKeyThrottleGuard } from '../api-keys/api-key-throttle.guard';
import { RateLimit } from '../api-keys/api-key-throttle.guard';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { GrantsService } from '../grants/grants.service';
import { ConnectionsService } from '../connections/connections.service';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { DualAuthGuard } from '../auth/guards/dual-auth.guard';

@ApiTags('availability')
@Controller('availability')
export class AvailabilityController {
  constructor(
    private availabilityService: AvailabilityService,
    private apiKeysService: ApiKeysService,
    private grantsService: GrantsService,
    private connectionsService: ConnectionsService,
  ) {}

  // JWT-authenticated route must be BEFORE the :handle catch-all
  @Get('web/:handle')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get user availability (web)',
    description: 'Get free/busy data for a user by handle. Requires JWT auth and a calendar:free_busy grant from the target.',
  })
  @ApiParam({ name: 'handle', description: 'Target user handle' })
  @ApiQuery({ name: 'startDate', required: true, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'endDate', required: true, description: 'End date (ISO 8601)' })
  @ApiQuery({ name: 'timezone', required: false, description: 'Timezone (default: UTC)' })
  @ApiResponse({ status: 200, description: 'Availability returned' })
  @ApiResponse({ status: 403, description: 'Forbidden - no grant from target' })
  async getAvailabilityWeb(
    @Request() req: any,
    @Param('handle') handle: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('timezone') timezone: string = 'UTC',
  ) {
    const myHandle = req.user?.handle;
    if (!myHandle) {
      throw new ForbiddenException('Your account does not have a @handle.');
    }

    // Skip grant check when viewing your own availability
    const isSelf = myHandle.toLowerCase() === handle.toLowerCase();
    if (!isSelf) {
      const hasGrant = await this.grantsService.hasAccess(
        myHandle,
        handle,
        'calendar',
        'free_busy',
      );

      if (!hasGrant) {
        throw new ForbiddenException(
          `@${handle} has not granted you calendar:free_busy access.`,
        );
      }
    }

    return this.availabilityService.getAvailabilityByHandle(
      handle,
      new Date(startDate),
      new Date(endDate),
      timezone,
    );
  }

  @Get('mutual')
  @UseGuards(DualAuthGuard)
  @ApiOperation({
    summary: 'Find mutual availability',
    description: 'Find overlapping free time across multiple users. Accepts session auth (web) or API key auth (MCP). API key requires grants; session auth does not.',
  })
  @ApiQuery({ name: 'handles', required: true, description: 'Comma-separated list of handles' })
  @ApiQuery({ name: 'startDate', required: true, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'endDate', required: true, description: 'End date (ISO 8601)' })
  @ApiQuery({ name: 'duration', required: true, description: 'Meeting duration in minutes' })
  @ApiQuery({ name: 'timezone', required: false, description: 'Timezone (default: UTC)' })
  @ApiResponse({ status: 200, description: 'Mutual availability slots returned' })
  @ApiResponse({ status: 403, description: 'Forbidden - missing auth or grants' })
  async findMutualAvailability(
    @Request() req: any,
    @Query('handles') handles: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('duration') duration: string,
    @Query('timezone') timezone: string = 'UTC',
  ) {
    const handleList = handles.split(',').map((h) => h.trim());
    let myHandle: string;
    let userId: string;

    if (req.user?.id) {
      // Session auth (web dashboard)
      myHandle = req.user.handle;
      userId = req.user.id;
      if (!myHandle) {
        throw new ForbiddenException('Your account does not have a @handle.');
      }
    } else if (req.apiKey) {
      // API key auth (MCP)
      if (!this.apiKeysService.hasPermission(req.apiKey.permissions, 'availability:read')) {
        throw new ForbiddenException('API key does not have availability:read permission');
      }
      if (!req.apiKeyUser?.handle) {
        throw new ForbiddenException('API key must belong to a user with a @handle.');
      }
      myHandle = req.apiKeyUser.handle;
      userId = req.apiKeyUser.id;

      // API key path requires grants from every handle
      const denied: string[] = [];
      for (const h of handleList) {
        const hasGrant = await this.grantsService.hasAccess(myHandle, h, 'calendar', 'free_busy');
        if (!hasGrant) denied.push(h);
      }
      if (denied.length > 0) {
        throw new ForbiddenException(
          `Missing calendar:free_busy grant from: ${denied.map((h) => `@${h}`).join(', ')}. Request access first.`,
        );
      }
    } else {
      throw new ForbiddenException('Authentication required (session or API key).');
    }

    const hasCalendar = await this.connectionsService.hasConnectedCalendar(userId);
    if (!hasCalendar) {
      throw new ForbiddenException(
        'You must connect at least one calendar. Visit https://bolospot.com/dashboard/connections',
      );
    }

    // Include the requesting user in the list
    if (!handleList.includes(myHandle)) {
      handleList.unshift(myHandle);
    }

    return this.availabilityService.findMutualAvailability(
      handleList,
      new Date(startDate),
      new Date(endDate),
      parseInt(duration, 10),
      timezone,
    );
  }

  @Get(':handle')
  @UseGuards(ApiKeyGuard, ApiKeyThrottleGuard)
  @RateLimit(60, 60) // 60 requests per minute per API key
  @ApiSecurity('api-key')
  @ApiOperation({
    summary: 'Get user availability',
    description: 'Get availability for a user by handle. Requires a valid API key AND a Bolo grant from the target with calendar:free_busy scope.',
  })
  @ApiParam({ name: 'handle', description: 'User handle' })
  @ApiQuery({ name: 'startDate', required: true, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'endDate', required: true, description: 'End date (ISO 8601)' })
  @ApiQuery({ name: 'timezone', required: false, description: 'Timezone (default: UTC)' })
  @ApiResponse({ status: 200, description: 'Availability returned' })
  @ApiResponse({ status: 403, description: 'Forbidden - no grant from target' })
  async getAvailability(
    @Request() req: any,
    @Param('handle') handle: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('timezone') timezone: string = 'UTC',
  ) {
    // API key must have availability:read to even call this endpoint
    if (!this.apiKeysService.hasPermission(req.apiKey.permissions, 'availability:read')) {
      throw new ForbiddenException('API key does not have availability:read permission');
    }

    // MANDATORY: The target must have granted calendar:free_busy to the API key owner
    if (!req.apiKeyUser?.handle) {
      throw new ForbiddenException(
        'Cannot determine your identity. API key must belong to a user with a @handle.',
      );
    }

    // MANDATORY: Requestor must have at least one connected calendar (proof of real account)
    const hasCalendar = await this.connectionsService.hasConnectedCalendar(req.apiKeyUser.id);
    if (!hasCalendar) {
      throw new ForbiddenException(
        'You must connect at least one calendar to use the availability API. ' +
        'Visit https://bolospot.com/dashboard/connections to connect Google or Microsoft.',
      );
    }

    const hasGrant = await this.grantsService.hasAccess(
      req.apiKeyUser.handle,
      handle,
      'calendar',
      'free_busy',
    );

    if (!hasGrant) {
      throw new ForbiddenException(
        `@${handle} has not granted you calendar:free_busy access. ` +
        `Request it: bolo request @${handle} calendar:free_busy`,
      );
    }

    return this.availabilityService.getAvailabilityByHandle(
      handle,
      new Date(startDate),
      new Date(endDate),
      timezone,
    );
  }
}
