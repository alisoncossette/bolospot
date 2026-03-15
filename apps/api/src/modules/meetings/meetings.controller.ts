import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { MeetingsService } from './meetings.service';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { Request as ExpressRequest } from 'express';

interface AuthenticatedRequest extends ExpressRequest {
  user: { id: string };
}

@ApiTags('meetings')
@Controller('meetings')
export class MeetingsController {
  constructor(private meetingsService: MeetingsService) {}

  @Post()
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create meeting request', description: 'Create a new meeting request and invite participants' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['title', 'duration', 'dateRangeStart', 'dateRangeEnd', 'timezone'],
      properties: {
        title: { type: 'string', example: 'Team Standup' },
        description: { type: 'string', example: 'Weekly sync meeting' },
        duration: { type: 'number', example: 30, description: 'Duration in minutes' },
        dateRangeStart: { type: 'string', format: 'date-time', example: '2024-01-15T00:00:00Z' },
        dateRangeEnd: { type: 'string', format: 'date-time', example: '2024-01-20T23:59:59Z' },
        timezone: { type: 'string', example: 'America/New_York' },
        timeRangeStart: { type: 'number', example: 9, description: 'Start hour (0-23)' },
        timeRangeEnd: { type: 'number', example: 17, description: 'End hour (0-23)' },
        participantEmails: { type: 'array', items: { type: 'string' }, example: ['guest@example.com'] },
        participantHandles: { type: 'array', items: { type: 'string' }, example: ['johndoe'] },
        participantPhones: { type: 'array', items: { type: 'string' }, example: ['+15551234567'], description: 'Phone numbers - will resolve to Bolo @handle if verified' },
        recordingPolicy: { type: 'string', enum: ['ALLOWED', 'PRE_APPROVED', 'NOT_ALLOWED'] },
        preferredConnectionId: { type: 'string', description: 'Calendar connection to use for creating event and video conferencing' },
        createVideoConference: { type: 'boolean', description: 'Auto-generate Google Meet or Teams link based on calendar provider', default: true },
        workflow: { type: 'string', enum: ['AUTO', 'MANUAL'], description: 'AUTO = schedule first available, MANUAL = let organizer pick', default: 'AUTO' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Meeting created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createMeeting(
    @Request() req: AuthenticatedRequest,
    @Body()
    body: {
      title: string;
      description?: string;
      duration: number;
      dateRangeStart: string;
      dateRangeEnd: string;
      timezone: string;
      timeRangeStart?: number;
      timeRangeEnd?: number;
      participantEmails?: string[];
      participantHandles?: string[];
      participantPhones?: string[];
      recordingPolicy?: string;
      preferredConnectionId?: string;
      createVideoConference?: boolean;
      workflow?: string;
    },
  ) {
    return this.meetingsService.createMeeting(req.user.id, {
      ...body,
      dateRangeStart: new Date(body.dateRangeStart),
      dateRangeEnd: new Date(body.dateRangeEnd),
      timeRangeStart: body.timeRangeStart,
      timeRangeEnd: body.timeRangeEnd,
      participantEmails: body.participantEmails || [],
      participantHandles: body.participantHandles || [],
      participantPhones: body.participantPhones || [],
      preferredConnectionId: body.preferredConnectionId,
      createVideoConference: body.createVideoConference ?? true,
      workflow: body.workflow || 'AUTO',
    });
  }

  @Post('book')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Book instant meeting', description: 'Book a meeting with a specific time (no availability coordination)' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['title', 'startTime', 'endTime'],
      properties: {
        title: { type: 'string', example: 'Quick call' },
        description: { type: 'string' },
        startTime: { type: 'string', format: 'date-time' },
        endTime: { type: 'string', format: 'date-time' },
        timezone: { type: 'string', example: 'UTC' },
        participantHandles: { type: 'array', items: { type: 'string' } },
        participantEmails: { type: 'array', items: { type: 'string' } },
        location: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Meeting booked' })
  async bookMeeting(
    @Request() req: AuthenticatedRequest,
    @Body()
    body: {
      title: string;
      description?: string;
      startTime: string;
      endTime: string;
      timezone?: string;
      participantHandles?: string[];
      participantEmails?: string[];
      location?: string;
    },
  ) {
    return this.meetingsService.bookMeeting(req.user.id, {
      ...body,
      startTime: new Date(body.startTime),
      endTime: new Date(body.endTime),
      timezone: body.timezone || 'UTC',
      participantHandles: body.participantHandles || [],
      participantEmails: body.participantEmails || [],
    });
  }

  @Get()
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List meetings', description: 'List meetings for the authenticated user' })
  @ApiQuery({ name: 'role', required: false, enum: ['organizer', 'participant', 'all'], description: 'Filter by role' })
  @ApiResponse({ status: 200, description: 'Meetings list returned' })
  async listMeetings(
    @Request() req: AuthenticatedRequest,
    @Query('role') role: 'organizer' | 'participant' | 'all' = 'all',
  ) {
    return this.meetingsService.listUserMeetings(req.user.id, role);
  }

  @Get('incoming/requests')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get incoming requests', description: 'Get pending meeting invitations for the user' })
  @ApiResponse({ status: 200, description: 'Incoming requests returned' })
  async getIncomingRequests(@Request() req: AuthenticatedRequest) {
    return this.meetingsService.getIncomingRequests(req.user.id);
  }

  @Patch('invitation/:participantId/respond')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Respond to invitation', description: 'Approve or decline a meeting invitation' })
  @ApiParam({ name: 'participantId', description: 'Participant record ID' })
  @ApiBody({ schema: { type: 'object', properties: { response: { type: 'string', enum: ['APPROVED', 'DECLINED'] } } } })
  @ApiResponse({ status: 200, description: 'Response recorded' })
  async respondToInvitation(
    @Request() req: AuthenticatedRequest,
    @Param('participantId') participantId: string,
    @Body() body: { response: 'APPROVED' | 'DECLINED' },
  ) {
    return this.meetingsService.respondToInvitation(
      participantId,
      req.user.id,
      body.response,
    );
  }

  @Get(':id')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get meeting', description: 'Get meeting details by ID' })
  @ApiParam({ name: 'id', description: 'Meeting ID' })
  @ApiResponse({ status: 200, description: 'Meeting returned' })
  @ApiResponse({ status: 404, description: 'Meeting not found' })
  async getMeeting(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.meetingsService.getMeeting(id, req.user.id);
  }

  @Get(':id/availability')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get combined availability', description: 'Get all participants busy times for communal calendar view' })
  @ApiParam({ name: 'id', description: 'Meeting ID' })
  @ApiResponse({ status: 200, description: 'Availability data returned' })
  async getMeetingAvailability(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.meetingsService.getMeetingAvailability(id, req.user.id);
  }

  @Get('share/:shareCode')
  @ApiOperation({ summary: 'Get meeting by share code', description: 'Get public meeting info by share code (no auth required)' })
  @ApiParam({ name: 'shareCode', description: 'Meeting share code' })
  @ApiResponse({ status: 200, description: 'Meeting info returned' })
  @ApiResponse({ status: 404, description: 'Meeting not found' })
  async getMeetingByShareCode(@Param('shareCode') shareCode: string) {
    return this.meetingsService.getMeetingByShareCode(shareCode);
  }

  @Patch(':id/range')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update meeting date range', description: 'Modify the date/time range for a pending meeting' })
  @ApiParam({ name: 'id', description: 'Meeting ID' })
  @ApiResponse({ status: 200, description: 'Meeting range updated' })
  async updateMeetingRange(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    body: {
      dateRangeStart?: string;
      dateRangeEnd?: string;
      timeRangeStart?: number;
      timeRangeEnd?: number;
    },
  ) {
    return this.meetingsService.updateMeetingRange(id, req.user.id, {
      dateRangeStart: body.dateRangeStart ? new Date(body.dateRangeStart) : undefined,
      dateRangeEnd: body.dateRangeEnd ? new Date(body.dateRangeEnd) : undefined,
      timeRangeStart: body.timeRangeStart,
      timeRangeEnd: body.timeRangeEnd,
    });
  }

  @Patch(':id/confirm')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirm meeting time', description: 'Confirm the final time for a meeting' })
  @ApiParam({ name: 'id', description: 'Meeting ID' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['startTime', 'endTime'],
      properties: {
        startTime: { type: 'string', format: 'date-time' },
        endTime: { type: 'string', format: 'date-time' },
        meetingLink: { type: 'string', example: 'https://meet.google.com/abc-xyz' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Meeting confirmed' })
  async confirmMeeting(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    body: {
      startTime: string;
      endTime: string;
      meetingLink?: string;
    },
  ) {
    return this.meetingsService.confirmMeeting(
      id,
      req.user.id,
      new Date(body.startTime),
      new Date(body.endTime),
      body.meetingLink,
    );
  }

  @Delete(':id')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel meeting', description: 'Cancel a meeting (organizer only)' })
  @ApiParam({ name: 'id', description: 'Meeting ID' })
  @ApiResponse({ status: 200, description: 'Meeting cancelled' })
  async cancelMeeting(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.meetingsService.cancelMeeting(id, req.user.id);
  }

  @Post(':id/withdraw')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Withdraw from meeting', description: 'Withdraw as a participant from a meeting' })
  @ApiParam({ name: 'id', description: 'Meeting ID' })
  @ApiResponse({ status: 200, description: 'Withdrawn successfully' })
  async withdrawFromMeeting(
    @Request() req: AuthenticatedRequest,
    @Param('id') meetingId: string,
  ) {
    return this.meetingsService.withdrawFromMeeting(meetingId, req.user.id);
  }

  @Post(':id/resend-invite/:participantId')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resend invitation', description: 'Resend invitation email to a participant' })
  @ApiParam({ name: 'id', description: 'Meeting ID' })
  @ApiParam({ name: 'participantId', description: 'Participant ID' })
  @ApiResponse({ status: 200, description: 'Invitation resent' })
  async resendInvite(
    @Request() req: AuthenticatedRequest,
    @Param('id') meetingId: string,
    @Param('participantId') participantId: string,
  ) {
    return this.meetingsService.resendInvite(meetingId, participantId, req.user.id);
  }

  @Get(':id/email-status')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get email delivery status', description: 'Get email delivery status for all participants' })
  @ApiParam({ name: 'id', description: 'Meeting ID' })
  @ApiResponse({ status: 200, description: 'Email status returned' })
  async getEmailStatus(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.meetingsService.getEmailStatus(id, req.user.id);
  }

  @Post(':id/retry-failed-emails')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Retry failed emails', description: 'Retry sending emails to all participants with failed delivery' })
  @ApiParam({ name: 'id', description: 'Meeting ID' })
  @ApiResponse({ status: 200, description: 'Failed emails retried' })
  async retryFailedEmails(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.meetingsService.retryFailedEmails(id, req.user.id);
  }

  @Post(':id/archive')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Archive or hide meeting',
    description: 'For organizers: archives the entire meeting (changes status to ARCHIVED). For participants: hides the meeting from their view only (other participants still see it).'
  })
  @ApiParam({ name: 'id', description: 'Meeting ID' })
  @ApiResponse({ status: 200, description: 'Meeting archived or hidden' })
  async archiveMeeting(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.meetingsService.archiveMeeting(id, req.user.id);
  }

  @Delete(':id/permanent')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete meeting permanently', description: 'Permanently delete a meeting' })
  @ApiParam({ name: 'id', description: 'Meeting ID' })
  @ApiResponse({ status: 200, description: 'Meeting deleted' })
  async deleteMeetingPermanently(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.meetingsService.deleteMeetingPermanently(id, req.user.id);
  }

  // --- Hours Override Request Endpoints ---

  @Post(':id/override-request')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request hours override', description: 'Request to schedule a meeting outside a participant\'s bookable hours' })
  @ApiParam({ name: 'id', description: 'Meeting ID' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['targetUserId', 'requestedStart', 'requestedEnd'],
      properties: {
        targetUserId: { type: 'string', description: 'User whose hours to override' },
        requestedStart: { type: 'number', description: 'Requested start hour (0-23)' },
        requestedEnd: { type: 'number', description: 'Requested end hour (0-23)' },
        requestedDays: { type: 'array', items: { type: 'number' }, description: 'Requested days (0=Sun, 6=Sat)' },
        reason: { type: 'string', description: 'Reason for the override request' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Override request created' })
  async requestHoursOverride(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: {
      targetUserId: string;
      requestedStart: number;
      requestedEnd: number;
      requestedDays?: number[];
      reason?: string;
    },
  ) {
    return this.meetingsService.requestHoursOverride(
      id, req.user.id, body.targetUserId,
      body.requestedStart, body.requestedEnd,
      body.requestedDays, body.reason,
    );
  }

  @Get('override-requests')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List override requests', description: 'List hours override requests for the authenticated user' })
  @ApiQuery({ name: 'filter', required: false, enum: ['pending', 'all'] })
  @ApiResponse({ status: 200, description: 'Override requests returned' })
  async getHoursOverrideRequests(
    @Request() req: AuthenticatedRequest,
    @Query('filter') filter?: 'pending' | 'all',
  ) {
    return this.meetingsService.getHoursOverrideRequests(req.user.id, filter);
  }

  @Patch('override-requests/:overrideId/respond')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Respond to override request', description: 'Approve or decline an hours override request' })
  @ApiParam({ name: 'overrideId', description: 'Override request ID' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['response'],
      properties: {
        response: { type: 'string', enum: ['APPROVED', 'DECLINED'] },
        responseNote: { type: 'string', description: 'Optional note with response' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Override request responded to' })
  async respondToHoursOverride(
    @Request() req: AuthenticatedRequest,
    @Param('overrideId') overrideId: string,
    @Body() body: { response: 'APPROVED' | 'DECLINED'; responseNote?: string },
  ) {
    return this.meetingsService.respondToHoursOverride(overrideId, req.user.id, body.response, body.responseNote);
  }
}
