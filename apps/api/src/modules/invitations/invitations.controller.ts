import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { InvitationsService } from './invitations.service';

interface AvailabilitySlotDto {
  startTime: string;
  endTime: string;
  preference?: 'AVAILABLE' | 'PREFERRED' | 'IF_NEEDED';
}

@ApiTags('invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(private invitationsService: InvitationsService) {}

  @Get(':token')
  @ApiOperation({ summary: 'Get invitation details', description: 'Get meeting invitation details by token (no auth required)' })
  @ApiParam({ name: 'token', description: 'Invitation token' })
  @ApiResponse({ status: 200, description: 'Invitation details returned' })
  @ApiResponse({ status: 404, description: 'Invitation not found' })
  async getInvitation(@Param('token') token: string) {
    return this.invitationsService.getInviteByToken(token);
  }

  @Post(':token/availability')
  @ApiOperation({ summary: 'Submit availability', description: 'Submit manual availability slots for a meeting invitation (no auth required)' })
  @ApiParam({ name: 'token', description: 'Invitation token' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['slots'],
      properties: {
        slots: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              startTime: { type: 'string', format: 'date-time' },
              endTime: { type: 'string', format: 'date-time' },
              preference: { type: 'string', enum: ['AVAILABLE', 'PREFERRED', 'IF_NEEDED'] },
            },
          },
        },
        name: { type: 'string', example: 'John Doe' },
        timezone: { type: 'string', example: 'America/New_York' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Availability submitted' })
  @ApiResponse({ status: 400, description: 'Invalid input or expired invitation' })
  async submitAvailability(
    @Param('token') token: string,
    @Body()
    body: {
      slots: AvailabilitySlotDto[];
      name?: string;
      timezone?: string;
    },
  ) {
    return this.invitationsService.submitManualAvailability(
      token,
      body.slots,
      body.name,
      body.timezone,
    );
  }

  @Post(':token/decline')
  @ApiOperation({ summary: 'Decline invitation', description: 'Decline a meeting invitation (no auth required)' })
  @ApiParam({ name: 'token', description: 'Invitation token' })
  @ApiResponse({ status: 200, description: 'Invitation declined' })
  @ApiResponse({ status: 404, description: 'Invitation not found' })
  async declineInvitation(@Param('token') token: string) {
    return this.invitationsService.declineInvitation(token);
  }

  @Get(':token/connect')
  @ApiOperation({ summary: 'Get connect URL', description: 'Get URL to register/login and connect calendar for this invitation' })
  @ApiParam({ name: 'token', description: 'Invitation token' })
  @ApiQuery({ name: 'redirect', required: false, description: 'Redirect URL after registration' })
  @ApiResponse({ status: 200, description: 'Connect URL returned' })
  async getConnectUrl(
    @Param('token') token: string,
    @Query('redirect') redirect?: string,
  ) {
    await this.invitationsService.getInviteByToken(token);

    return {
      connectUrl: `/auth/signup?invite=${token}${redirect ? `&redirect=${encodeURIComponent(redirect)}` : ''}`,
      message: 'Redirect user to this URL to connect their calendar',
    };
  }

  @Post(':token/link')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Link invitation to user', description: 'Link an invitation participant to the authenticated user account' })
  @ApiParam({ name: 'token', description: 'Invitation token' })
  @ApiResponse({ status: 200, description: 'Participant linked to user' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async linkToUser(@Param('token') token: string, @Request() req: any) {
    return this.invitationsService.linkParticipantToUser(token, req.user.id);
  }
}
