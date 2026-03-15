import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleCalendarProvider } from '../../providers/google/google-calendar.provider';
import { MicrosoftCalendarProvider } from '../../providers/microsoft/microsoft-calendar.provider';
import { CalendarProvider } from '@prisma/client';

export interface UnifiedEvent {
  id: string;
  calendarId: string;
  calendarName: string;
  calendarColor: string;
  provider: 'GOOGLE' | 'MICROSOFT';
  title: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  status: string;
  showAs: string;
  externalUrl?: string | null;
  boloMeetingId?: string | null;
}

export interface ConnectionError {
  connectionId: string;
  provider: string;
  error: string;
}

export interface UnifiedEventsResponse {
  events: UnifiedEvent[];
  meta: {
    startDate: string;
    endDate: string;
    calendarsQueried: number;
    errors?: ConnectionError[];
  };
}

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private prisma: PrismaService,
    private googleProvider: GoogleCalendarProvider,
    private microsoftProvider: MicrosoftCalendarProvider,
  ) {}

  async getUnifiedEvents(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<UnifiedEventsResponse> {
    // Get user's custom busy block title for filtering
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { busyBlockTitle: true },
    });
    const busyBlockTitle = user?.busyBlockTitle || 'Busy (Bolo)';

    // Get all enabled connections with their calendars
    const connections = await this.prisma.calendarConnection.findMany({
      where: {
        userId,
        isEnabled: true,
      },
      include: {
        calendars: {
          where: { isSelected: true },
        },
      },
    });

    const allEvents: UnifiedEvent[] = [];
    const errors: ConnectionError[] = [];
    let calendarsQueried = 0;

    // Fetch events from each connection in parallel
    const fetchPromises = connections.map(async (connection) => {
      try {
        // Ensure valid token
        const accessToken = await this.ensureValidToken(connection);

        // Fetch events based on provider
        const events = await this.fetchEventsFromProvider(
          connection.provider,
          accessToken,
          connection.calendars,
          startDate,
          endDate,
          busyBlockTitle,
        );

        calendarsQueried += connection.calendars.length;
        return { events, error: null };
      } catch (error) {
        this.logger.error(
          `Failed to fetch events from ${connection.provider} (${connection.id}): ${error.message}`,
        );
        return {
          events: [],
          error: {
            connectionId: connection.id,
            provider: connection.provider,
            error: error.message,
          },
        };
      }
    });

    const results = await Promise.all(fetchPromises);

    for (const result of results) {
      allEvents.push(...result.events);
      if (result.error) {
        errors.push(result.error);
      }
    }

    // Sort events by start time
    allEvents.sort(
      (a, b) =>
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    );

    return {
      events: allEvents,
      meta: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        calendarsQueried,
        errors: errors.length > 0 ? errors : undefined,
      },
    };
  }

  async updateEvent(
    userId: string,
    calendarId: string,
    eventId: string,
    startTime: Date,
    endTime: Date,
  ): Promise<{ id: string }> {
    // Look up the calendar and its connection
    const calendar = await this.prisma.calendar.findFirst({
      where: { id: calendarId },
      include: { connection: true },
    });

    if (!calendar || calendar.connection.userId !== userId) {
      throw new Error('Calendar not found or not authorized');
    }

    const connection = calendar.connection;
    const accessToken = await this.ensureValidToken(connection);

    if (connection.provider === CalendarProvider.GOOGLE) {
      return this.googleProvider.updateEvent(
        accessToken,
        calendar.externalId,
        eventId,
        { startTime, endTime },
      );
    } else if (connection.provider === CalendarProvider.MICROSOFT) {
      return this.microsoftProvider.updateEvent(
        accessToken,
        calendar.externalId,
        eventId,
        { startTime, endTime },
      );
    }

    throw new Error(`Unsupported provider: ${connection.provider}`);
  }

  private async ensureValidToken(connection: any): Promise<string> {
    if (!connection.accessToken) {
      throw new Error('No access token available');
    }

    // Check if token expires within 5 minutes
    const bufferMs = 5 * 60 * 1000;
    const tokenExpiresSoon =
      connection.expiresAt &&
      connection.expiresAt.getTime() - Date.now() < bufferMs;

    if (tokenExpiresSoon) {
      if (!connection.refreshToken) {
        throw new Error('Token expired and no refresh token available');
      }

      this.logger.log(
        `Refreshing token for ${connection.provider} connection ${connection.id}`,
      );

      let newTokens;
      if (connection.provider === CalendarProvider.GOOGLE) {
        newTokens = await this.googleProvider.refreshToken(
          connection.refreshToken,
        );
      } else if (connection.provider === CalendarProvider.MICROSOFT) {
        newTokens = await this.microsoftProvider.refreshToken(
          connection.refreshToken,
        );
      } else {
        throw new Error(`Unsupported provider: ${connection.provider}`);
      }

      // Update stored tokens
      await this.prisma.calendarConnection.update({
        where: { id: connection.id },
        data: {
          accessToken: newTokens.accessToken,
          expiresAt: newTokens.expiresAt,
        },
      });

      return newTokens.accessToken;
    }

    return connection.accessToken;
  }

  private async fetchEventsFromProvider(
    provider: CalendarProvider,
    accessToken: string,
    calendars: any[],
    startDate: Date,
    endDate: Date,
    busyBlockTitle: string = 'Busy (Bolo)',
  ): Promise<UnifiedEvent[]> {
    const events: UnifiedEvent[] = [];

    for (const calendar of calendars) {
      let calendarEvents: any[] = [];

      if (provider === CalendarProvider.GOOGLE) {
        calendarEvents = await this.googleProvider.getEvents(
          accessToken,
          calendar.externalId,
          startDate,
          endDate,
        );
      } else if (provider === CalendarProvider.MICROSOFT) {
        calendarEvents = await this.microsoftProvider.getEvents(
          accessToken,
          calendar.externalId,
          startDate,
          endDate,
        );
      }

      // Map to unified format, filtering out Bolo busy block events
      for (const event of calendarEvents) {
        // Skip busy block events created by Bolo sync
        if (event.title === busyBlockTitle || event.title === 'Busy (Bolo)') continue;

        events.push({
          id: event.id,
          calendarId: calendar.id,
          calendarName: calendar.name,
          calendarColor: calendar.color || '#0078d4',
          provider: provider as 'GOOGLE' | 'MICROSOFT',
          title: event.title,
          description: event.description,
          location: event.location,
          startTime:
            event.startTime instanceof Date
              ? event.startTime.toISOString()
              : event.startTime,
          endTime:
            event.endTime instanceof Date
              ? event.endTime.toISOString()
              : event.endTime,
          isAllDay: event.isAllDay,
          status: event.status || 'CONFIRMED',
          showAs: event.showAs || 'BUSY',
          externalUrl: event.externalUrl || null,
          boloMeetingId: event.boloMeetingId || null,
        });
      }
    }

    return events;
  }
}
