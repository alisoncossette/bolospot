import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiBody, ApiSecurity } from '@nestjs/swagger';
import { GrantsService } from './grants.service';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { ApiKeyGuard } from '../api-keys/api-key.guard';
import { ApiKeyThrottleGuard } from '../api-keys/api-key-throttle.guard';
import { RateLimit } from '../api-keys/api-key-throttle.guard';

@ApiTags('grants')
@Controller()
export class GrantsController {
  constructor(private grantsService: GrantsService) {}

  // ─── Authenticated endpoints (JWT - dashboard / CLI with login) ──────

  @Post('grants')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create grant', description: 'Grant access to another @handle for a permission category' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['granteeHandle', 'widget', 'scopes'],
      properties: {
        granteeHandle: { type: 'string', example: '@jane' },
        widget: { type: 'string', example: 'calendar' },
        scopes: { type: 'array', items: { type: 'string' }, example: ['free_busy'] },
        note: { type: 'string', example: 'My assistant' },
        expiresAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Grant created' })
  async createGrant(@Request() req: any, @Body() body: any) {
    return this.grantsService.createGrant(req.user.id, {
      granteeHandle: body.granteeHandle,
      widget: body.widget,
      scopes: body.scopes,
      note: body.note,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    });
  }

  @Delete('grants/:id')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke grant', description: 'Revoke a previously created grant' })
  @ApiParam({ name: 'id', description: 'Grant ID' })
  async revokeGrant(@Request() req: any, @Param('id') id: string) {
    return this.grantsService.revokeGrant(req.user.id, id);
  }

  @Get('grants/given')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List grants given', description: 'List all grants I have given out' })
  async listGrantsGiven(@Request() req: any) {
    return this.grantsService.listMyGrants(req.user.id);
  }

  @Get('grants/received')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List grants received', description: 'List all grants I have received' })
  async listGrantsReceived(@Request() req: any) {
    return this.grantsService.listGrantsToMe(req.user.id);
  }

  @Get('grants/requests')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List access requests', description: 'List pending access requests targeting me' })
  async listRequests(@Request() req: any) {
    return this.grantsService.listMyRequests(req.user.id);
  }

  @Patch('grants/requests/:id')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Respond to request', description: 'Approve or decline an access request' })
  @ApiParam({ name: 'id', description: 'Request ID' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['approve'],
      properties: {
        approve: { type: 'boolean', example: true },
      },
    },
  })
  async respondToRequest(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { approve: boolean },
  ) {
    return this.grantsService.respondToRequest(req.user.id, id, body.approve);
  }

  @Get('grants/widgets')
  @ApiOperation({ summary: 'List permission categories', description: 'List all Bolo permission categories and their scopes' })
  async getWidgets() {
    return this.grantsService.getWidgets();
  }

  // ─── Access check (AUTHENTICATED ONLY — no spoofing) ────────────────

  @Get('@:handle/access')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Check access (JWT)',
    description: 'Check what @handle has shared with you. Uses your authenticated identity — no spoofing possible.',
  })
  @ApiParam({ name: 'handle', description: 'Target @handle to check' })
  @ApiResponse({ status: 200, description: 'Access map returned' })
  async checkAccess(@Request() req: any, @Param('handle') handle: string) {
    const myHandle = await this.grantsService.getUserHandle(req.user.id);
    if (!myHandle) {
      throw new ForbiddenException('Your account does not have a @handle');
    }
    return this.grantsService.checkAccess(myHandle, handle);
  }

  @Get('@:handle/access/key')
  @UseGuards(ApiKeyGuard, ApiKeyThrottleGuard)
  @RateLimit(120, 60) // 120 access checks per minute (lightweight)
  @ApiSecurity('api-key')
  @ApiOperation({
    summary: 'Check access (API key)',
    description: 'Check what @handle has shared with you. Uses your API key identity.',
  })
  async checkAccessByKey(@Request() req: any, @Param('handle') handle: string) {
    if (!req.apiKeyUser?.handle) {
      throw new ForbiddenException('API key must belong to a user with a @handle');
    }
    return this.grantsService.checkAccess(req.apiKeyUser.handle, handle);
  }

  // ─── Handle existence check (public, but no grant info leaked) ──────

  @Get('@:handle/exists')
  @ApiOperation({
    summary: 'Check if handle exists',
    description: 'Check if a @handle is claimed on Bolo. Returns only existence status, no grant details.',
  })
  async checkExists(@Param('handle') handle: string) {
    const result = await this.grantsService.checkAccess('_probe', handle);
    // Only return existence — no grants, no profile details
    return {
      handle: result.handle,
      exists: result.exists,
      claimUrl: result.exists ? undefined : `https://bolospot.com/${result.handle}`,
    };
  }

  // ─── Access requests (API key — for agents) ─────────────────────────

  @Post('@:handle/request')
  @UseGuards(ApiKeyGuard, ApiKeyThrottleGuard)
  @RateLimit(10, 3600) // 10 requests per hour (anti-spam, matches service-level limit)
  @ApiSecurity('api-key')
  @ApiOperation({
    summary: 'Request access',
    description: 'Request access to a @handle\'s permission category. Your identity comes from your API key — no spoofing.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['widget', 'scopes'],
      properties: {
        widget: { type: 'string', example: 'calendar' },
        scopes: { type: 'array', items: { type: 'string' }, example: ['free_busy'] },
        reason: { type: 'string', example: 'I need to check your availability for scheduling' },
        agentName: { type: 'string', example: 'OpenClaw' },
      },
    },
  })
  async requestAccess(
    @Request() req: any,
    @Param('handle') handle: string,
    @Body() body: any,
  ) {
    // Identity MUST come from the authenticated API key, never from body
    if (!req.apiKeyUser?.id) {
      throw new ForbiddenException('API key must belong to a registered user');
    }

    return this.grantsService.requestAccess(req.apiKeyUser.id, {
      targetHandle: handle,
      widget: body.widget,
      scopes: body.scopes,
      reason: body.reason,
      agentName: body.agentName, // Agent name is informational, not identity
    });
  }
}
