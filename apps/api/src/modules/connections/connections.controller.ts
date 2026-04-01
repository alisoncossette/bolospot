import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
  Redirect,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { ConnectionsService } from './connections.service';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { ToggleSelectedDto, ToggleBusyBlockDto } from './dto/connections.dto';
import { Request as ExpressRequest } from 'express';

interface AuthenticatedRequest extends ExpressRequest {
  user: { id: string };
}

@ApiTags('connections')
@Controller('connections')
export class ConnectionsController {
  constructor(
    private connectionsService: ConnectionsService,
    private configService: ConfigService,
  ) {}

  @Get()
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List calendar connections', description: 'Get all connected calendars for the user' })
  @ApiResponse({ status: 200, description: 'Connections list returned' })
  async listConnections(@Request() req: AuthenticatedRequest) {
    return this.connectionsService.listConnections(req.user.id);
  }

  @Get(':id')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get connection details', description: 'Get details of a specific calendar connection' })
  @ApiParam({ name: 'id', description: 'Connection ID' })
  @ApiResponse({ status: 200, description: 'Connection returned' })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  async getConnection(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.connectionsService.getConnection(req.user.id, id);
  }

  @Delete(':id')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disconnect calendar', description: 'Remove a calendar connection' })
  @ApiParam({ name: 'id', description: 'Connection ID' })
  @ApiResponse({ status: 200, description: 'Connection deleted' })
  async deleteConnection(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.connectionsService.deleteConnection(req.user.id, id);
  }

  @Post(':id/sync')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sync calendar', description: 'Trigger manual sync of a calendar connection' })
  @ApiParam({ name: 'id', description: 'Connection ID' })
  @ApiResponse({ status: 200, description: 'Sync triggered' })
  async syncConnection(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.connectionsService.syncConnection(req.user.id, id);
  }

  @Post('sync-busy-blocks')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sync busy blocks', description: 'Sync busy time blocks across calendars that have busy block enabled' })
  @ApiResponse({ status: 200, description: 'Busy blocks synced' })
  async syncBusyBlocks(@Request() req: AuthenticatedRequest) {
    return this.connectionsService.syncBusyBlocks(req.user.id);
  }

  @Patch('calendars/:calendarId/selected')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Toggle calendar visibility', description: 'Show or hide a calendar on the calendar view' })
  @ApiParam({ name: 'calendarId', description: 'Calendar ID' })
  @ApiResponse({ status: 200, description: 'Calendar visibility toggled' })
  @ApiResponse({ status: 404, description: 'Calendar not found' })
  async toggleSelected(
    @Request() req: AuthenticatedRequest,
    @Param('calendarId') calendarId: string,
    @Body() body: ToggleSelectedDto,
  ) {
    return this.connectionsService.toggleSelected(req.user.id, calendarId, body.isSelected);
  }

  @Patch('calendars/:calendarId/busy-block')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Toggle busy block', description: 'Enable or disable busy block sync for a calendar' })
  @ApiParam({ name: 'calendarId', description: 'Calendar ID' })
  @ApiResponse({ status: 200, description: 'Busy block toggled' })
  @ApiResponse({ status: 404, description: 'Calendar not found' })
  async toggleBusyBlock(
    @Request() req: AuthenticatedRequest,
    @Param('calendarId') calendarId: string,
    @Body() body: ToggleBusyBlockDto,
  ) {
    return this.connectionsService.toggleBusyBlock(req.user.id, calendarId, body.isBusyBlock);
  }

  @Get('google/authorize')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start Google OAuth', description: 'Get Google OAuth authorization URL' })
  @ApiResponse({ status: 200, description: 'Returns authorization URL' })
  @ApiQuery({ name: 'returnUrl', required: false, description: 'URL to redirect to after OAuth completes (e.g. for BoMed or other apps)' })
  async googleAuthorize(@Request() req: AuthenticatedRequest, @Query('returnUrl') returnUrl?: string) {
    const redirectUri = `${this.configService.get('API_URL')}/api/connections/google/callback`;
    return this.connectionsService.getGoogleAuthUrl(req.user.id, redirectUri, returnUrl);
  }

  @Get('google/callback')
  @Redirect()
  @ApiOperation({ summary: 'Google OAuth callback', description: 'Handle Google OAuth callback (redirects to frontend)' })
  @ApiQuery({ name: 'code', required: true, description: 'OAuth authorization code' })
  @ApiQuery({ name: 'state', required: true, description: 'OAuth state parameter' })
  @ApiResponse({ status: 302, description: 'Redirects to frontend' })
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
  ) {
    const redirectUri = `${this.configService.get('API_URL')}/api/connections/google/callback`;
    const connection = await this.connectionsService.handleGoogleCallback(code, redirectUri, state);

    const { userId, returnUrl } = JSON.parse(Buffer.from(state, 'base64').toString());

    // Sync calendar and update pending invitations in background
    this.connectionsService.syncConnection(userId, connection.id).catch((err) => {
      console.error('Initial sync failed:', err);
    });

    // Update any pending meeting invitations now that user has a calendar
    this.connectionsService.updatePendingInvitationsOnConnect(userId).catch((err) => {
      console.error('Failed to update pending invitations:', err);
    });

    // If a returnUrl was specified (e.g. BoMed), redirect there with success param
    if (returnUrl) {
      const url = new URL(returnUrl);
      url.searchParams.set('calendar', 'connected');
      return { url: url.toString() };
    }

    // Check if user needs onboarding - if so, redirect to onboarding instead
    const user = await this.connectionsService.getUserById(userId);
    const frontendUrl = this.configService.get('FRONTEND_URL');

    if (user?.needsOnboarding) {
      return { url: `${frontendUrl}/onboarding?connected=google` };
    }

    return { url: `${frontendUrl}/dashboard/connections?success=google` };
  }

  @Get('microsoft/authorize')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start Microsoft OAuth', description: 'Get Microsoft OAuth authorization URL' })
  @ApiResponse({ status: 200, description: 'Returns authorization URL' })
  async microsoftAuthorize(@Request() req: AuthenticatedRequest) {
    const redirectUri = `${this.configService.get('API_URL')}/api/connections/microsoft/callback`;
    return this.connectionsService.getMicrosoftAuthUrl(req.user.id, redirectUri);
  }

  @Get('microsoft/callback')
  @Redirect()
  @ApiOperation({ summary: 'Microsoft OAuth callback', description: 'Handle Microsoft OAuth callback (redirects to frontend)' })
  @ApiQuery({ name: 'code', required: true, description: 'OAuth authorization code' })
  @ApiQuery({ name: 'state', required: true, description: 'OAuth state parameter' })
  @ApiResponse({ status: 302, description: 'Redirects to frontend' })
  async microsoftCallback(
    @Query('code') code: string,
    @Query('state') state: string,
  ) {
    const redirectUri = `${this.configService.get('API_URL')}/api/connections/microsoft/callback`;
    const connection = await this.connectionsService.handleMicrosoftCallback(code, redirectUri, state);

    const { userId } = JSON.parse(Buffer.from(state, 'base64').toString());

    // Sync calendar in background (same as Google)
    this.connectionsService.syncConnection(userId, connection.id).catch((err) => {
      console.error('Initial Microsoft sync failed:', err);
    });

    // Update any pending meeting invitations now that user has a calendar
    this.connectionsService.updatePendingInvitationsOnConnect(userId).catch((err) => {
      console.error('Failed to update pending invitations:', err);
    });

    // Check if user needs onboarding - if so, redirect to onboarding instead
    const user = await this.connectionsService.getUserById(userId);
    const frontendUrl = this.configService.get('FRONTEND_URL');

    if (user?.needsOnboarding) {
      return { url: `${frontendUrl}/onboarding?connected=microsoft` };
    }

    return { url: `${frontendUrl}/dashboard/connections?success=microsoft` };
  }
}
