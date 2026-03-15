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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { EventsService, UnifiedEventsResponse } from './events.service';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(private eventsService: EventsService) {}

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
    @Body() body: { calendarId: string; startTime: string; endTime: string },
  ) {
    if (!body.calendarId || !body.startTime || !body.endTime) {
      throw new BadRequestException('calendarId, startTime, and endTime are required');
    }

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
