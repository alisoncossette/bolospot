import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GoogleCalendarProvider {
  private readonly logger = new Logger(GoogleCalendarProvider.name);

  constructor(private configService: ConfigService) {}

  async getCalendars(accessToken: string) {
    const response = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Google Calendar API error (${response.status}): ${errorText}`);
      throw new Error(`Failed to fetch calendars: ${response.status}`);
    }

    const data = await response.json();
    return data.items.map((cal: any) => ({
      id: cal.id,
      name: cal.summary,
      description: cal.description,
      color: cal.backgroundColor,
      isPrimary: cal.primary || false,
      accessRole: cal.accessRole,
    }));
  }

  async getEvents(
    accessToken: string,
    calendarId: string,
    startDate: Date,
    endDate: Date,
  ) {
    const params = new URLSearchParams({
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
    });

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!response.ok) {
      throw new Error('Failed to fetch events');
    }

    const data = await response.json();
    return data.items.map((event: any) => ({
      id: event.id,
      title: event.summary,
      description: event.description,
      location: event.location,
      startTime: new Date(event.start.dateTime || event.start.date),
      endTime: new Date(event.end.dateTime || event.end.date),
      isAllDay: !event.start.dateTime,
      status: event.status?.toUpperCase() || 'CONFIRMED',
      showAs: event.transparency === 'transparent' ? 'FREE' : 'BUSY',
      externalUrl: event.htmlLink || null,
      // Extract Bolo meeting ID if this event was created by Bolo
      boloMeetingId: event.extendedProperties?.private?.boloMeetingId || null,
    }));
  }

  async createEvent(
    accessToken: string,
    calendarId: string,
    event: {
      title: string;
      description?: string;
      startTime: Date;
      endTime: Date;
      attendees?: string[];
      location?: string;
      boloMeetingId?: string;
      createVideoConference?: boolean; // Auto-create Google Meet link
    },
  ) {
    // Build description with Bolo meeting reference if provided
    let description = event.description || '';
    if (event.boloMeetingId) {
      description = description
        ? `${description}\n\n---\nScheduled via Bolo | Meeting ID: ${event.boloMeetingId}`
        : `Scheduled via Bolo | Meeting ID: ${event.boloMeetingId}`;
    }

    // Build request body
    const requestBody: Record<string, unknown> = {
      summary: event.title,
      description,
      start: {
        dateTime: event.startTime.toISOString(),
      },
      end: {
        dateTime: event.endTime.toISOString(),
      },
      attendees: event.attendees?.map((email) => ({ email })),
      // Store Bolo meeting ID in extended properties for retrieval
      extendedProperties: event.boloMeetingId
        ? {
            private: {
              boloMeetingId: event.boloMeetingId,
            },
          }
        : undefined,
    };

    // Add Google Meet conference if requested
    if (event.createVideoConference) {
      requestBody.conferenceData = {
        createRequest: {
          requestId: `bolo-${event.boloMeetingId || Date.now()}`,
          conferenceSolutionKey: {
            type: 'hangoutsMeet',
          },
        },
      };
    } else if (event.location) {
      // Only set location if not using video conference
      requestBody.location = event.location;
    }

    // Need conferenceDataVersion=1 to create Meet links
    const url = event.createVideoConference
      ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1`
      : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Failed to create event: ${errorText}`);
      throw new Error('Failed to create event');
    }

    const data = await response.json();

    // Extract Google Meet link if conference was created
    const meetLink = data.conferenceData?.entryPoints?.find(
      (ep: any) => ep.entryPointType === 'video'
    )?.uri;

    return {
      id: data.id,
      htmlLink: data.htmlLink,
      meetLink: meetLink || null,
    };
  }

  /**
   * Query Google Calendar Free/Busy API to find busy times.
   * Returns an array of busy time ranges.
   */
  async getFreeBusy(
    accessToken: string,
    calendarIds: string[],
    timeMin: Date,
    timeMax: Date,
  ): Promise<Map<string, Array<{ start: Date; end: Date }>>> {
    const response = await fetch(
      'https://www.googleapis.com/calendar/v3/freeBusy',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          items: calendarIds.map(id => ({ id })),
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Google Calendar FreeBusy API error (${response.status}): ${errorText}`);
      throw new Error(`Failed to fetch free/busy: ${response.status}`);
    }

    const data = await response.json();
    const result = new Map<string, Array<{ start: Date; end: Date }>>();

    for (const calendarId of calendarIds) {
      const calendarData = data.calendars?.[calendarId];
      if (calendarData?.busy) {
        result.set(
          calendarId,
          calendarData.busy.map((b: any) => ({
            start: new Date(b.start),
            end: new Date(b.end),
          })),
        );
      } else {
        result.set(calendarId, []);
      }
    }

    return result;
  }

  async listBusyBlockEvents(
    accessToken: string,
    calendarId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<Array<{ id: string }>> {
    const params = new URLSearchParams({
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
      singleEvents: 'true',
      privateExtendedProperty: 'boloBusyBlock=true',
    });

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Failed to list busy block events (${response.status}): ${errorText}`);
      return [];
    }

    const data = await response.json();
    this.logger.log(`Found ${(data.items || []).length} existing busy block events on Google calendar`);
    return (data.items || []).map((e: any) => ({ id: e.id }));
  }

  async deleteEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
  ): Promise<void> {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!response.ok && response.status !== 404) {
      this.logger.error(`Failed to delete event ${eventId}: ${response.status}`);
    }
  }

  async updateEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    updates: { startTime: Date; endTime: Date },
  ): Promise<{ id: string }> {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          start: { dateTime: updates.startTime.toISOString() },
          end: { dateTime: updates.endTime.toISOString() },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Failed to update event ${eventId}: ${errorText}`);
      throw new Error('Failed to update event');
    }

    const data = await response.json();
    return { id: data.id };
  }

  async createBusyBlock(
    accessToken: string,
    calendarId: string,
    startTime: Date,
    endTime: Date,
    sourceCalendarName: string,
    title: string = 'Busy (Bolo)',
  ): Promise<{ id: string }> {
    const requestBody = {
      summary: title,
      description: `Synced by Bolo from ${sourceCalendarName}`,
      start: { dateTime: startTime.toISOString() },
      end: { dateTime: endTime.toISOString() },
      transparency: 'opaque',
      visibility: 'private',
      extendedProperties: {
        private: {
          boloBusyBlock: 'true',
        },
      },
    };

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Failed to create busy block: ${errorText}`);
      throw new Error('Failed to create busy block event');
    }

    const data = await response.json();
    return { id: data.id };
  }

  async refreshToken(refreshToken: string) {
    const clientId = this.configService.get('GOOGLE_CLIENT_ID');
    const clientSecret = this.configService.get('GOOGLE_CLIENT_SECRET');

    this.logger.log(`Refreshing Google token (clientId: ${clientId?.substring(0, 10)}...)`);

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Token refresh failed (${response.status}): ${errorText}`);
      throw new Error(`Failed to refresh token: ${response.status}`);
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  }
}
