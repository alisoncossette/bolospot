import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MicrosoftCalendarProvider {
  private readonly logger = new Logger(MicrosoftCalendarProvider.name);

  constructor(private configService: ConfigService) {}

  async getCalendars(accessToken: string) {
    const response = await fetch(
      'https://graph.microsoft.com/v1.0/me/calendars',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Microsoft Graph API error (${response.status}): ${errorText}`);
      throw new Error(`Failed to fetch calendars: ${response.status}`);
    }

    const data = await response.json();
    return data.value.map((cal: any) => ({
      id: cal.id,
      name: cal.name,
      description: null,
      color: this.mapMicrosoftColor(cal.color),
      isPrimary: cal.isDefaultCalendar || false,
      accessRole: cal.canEdit ? 'WRITER' : 'READER',
    }));
  }

  async getEvents(
    accessToken: string,
    calendarId: string,
    startDate: Date,
    endDate: Date,
  ) {
    // Use calendarView to get expanded recurring event instances
    const select = 'id,subject,bodyPreview,location,start,end,showAs,isAllDay,isCancelled,webLink,sensitivity,categories';

    const params = new URLSearchParams({
      startDateTime: startDate.toISOString(),
      endDateTime: endDate.toISOString(),
      $select: select,
      $orderby: 'start/dateTime',
      $top: '250',
    });

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/calendarView?${params}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Prefer: 'outlook.timezone="UTC"',
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Microsoft Graph API error (${response.status}): ${errorText}`);
      throw new Error(`Failed to fetch events: ${response.status}`);
    }

    const data = await response.json();
    return data.value.map((event: any) => {
      // Try to extract Bolo meeting ID from body
      let boloMeetingId: string | null = null;
      if (event.bodyPreview?.includes('Meeting ID:')) {
        const match = event.bodyPreview.match(/Meeting ID:\s*([a-z0-9]+)/i);
        if (match) {
          boloMeetingId = match[1];
        }
      }

      return {
        id: event.id,
        title: event.subject || '(No title)',
        description: event.bodyPreview,
        location: event.location?.displayName,
        startTime: this.parseMicrosoftDateTime(event.start),
        endTime: this.parseMicrosoftDateTime(event.end),
        isAllDay: event.isAllDay || false,
        status: event.isCancelled ? 'CANCELLED' : 'CONFIRMED',
        showAs: this.mapShowAs(event.showAs),
        visibility: event.sensitivity === 'private' || event.sensitivity === 'confidential' ? 'private' : 'default',
        externalUrl: event.webLink || null,
        boloMeetingId,
        isBoloBusyBlock: Array.isArray(event.categories) && event.categories.includes('Bolo Busy Block'),
      };
    });
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
      createVideoConference?: boolean; // Auto-create Teams meeting link
    },
  ) {
    // Build description with Bolo meeting reference if provided
    let bodyContent = event.description || '';
    if (event.boloMeetingId) {
      bodyContent = bodyContent
        ? `${bodyContent}<br><br>---<br>Scheduled via Bolo | Meeting ID: ${event.boloMeetingId}`
        : `Scheduled via Bolo | Meeting ID: ${event.boloMeetingId}`;
    }

    // Build request body
    const requestBody: Record<string, unknown> = {
      subject: event.title,
      body: {
        contentType: 'HTML',
        content: bodyContent,
      },
      start: {
        dateTime: event.startTime.toISOString().replace('Z', ''),
        timeZone: 'UTC',
      },
      end: {
        dateTime: event.endTime.toISOString().replace('Z', ''),
        timeZone: 'UTC',
      },
      attendees: event.attendees?.map((email) => ({
        emailAddress: { address: email },
        type: 'required',
      })),
    };

    // Add Teams meeting if requested
    if (event.createVideoConference) {
      requestBody.isOnlineMeeting = true;
      requestBody.onlineMeetingProvider = 'teamsForBusiness';
    } else if (event.location) {
      requestBody.location = {
        displayName: event.location,
      };
    }

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/events`,
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
      this.logger.error(`Failed to create Microsoft event: ${errorText}`);
      throw new Error('Failed to create event');
    }

    const data = await response.json();

    return {
      id: data.id,
      htmlLink: data.webLink,
      meetLink: data.onlineMeeting?.joinUrl || null,
    };
  }

  async updateEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    updates: { startTime: Date; endTime: Date },
  ): Promise<{ id: string }> {
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          start: {
            dateTime: updates.startTime.toISOString().replace('Z', ''),
            timeZone: 'UTC',
          },
          end: {
            dateTime: updates.endTime.toISOString().replace('Z', ''),
            timeZone: 'UTC',
          },
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

  async listBusyBlockEvents(
    accessToken: string,
    calendarId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<Array<{ id: string }>> {
    // Use the events endpoint with $filter on categories (calendarView doesn't support category filtering)
    const filter = `categories/any(c:c eq 'Bolo Busy Block') and start/dateTime ge '${startDate.toISOString()}' and end/dateTime le '${endDate.toISOString()}'`;
    const params = new URLSearchParams({
      $filter: filter,
      $select: 'id',
      $top: '500',
    });

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Prefer: 'outlook.timezone="UTC"',
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Failed to list busy block events (${response.status}): ${errorText}`);
      // Fallback: try without date filter in case OData filtering is limited
      return this.listBusyBlockEventsFallback(accessToken, calendarId);
    }

    const data = await response.json();
    this.logger.log(`Found ${(data.value || []).length} existing busy block events on Microsoft calendar`);
    return (data.value || []).map((e: any) => ({ id: e.id }));
  }

  private async listBusyBlockEventsFallback(
    accessToken: string,
    calendarId: string,
  ): Promise<Array<{ id: string }>> {
    // Simpler query: just filter by category without date constraints
    const params = new URLSearchParams({
      $filter: "categories/any(c:c eq 'Bolo Busy Block')",
      $select: 'id',
      $top: '500',
    });

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Prefer: 'outlook.timezone="UTC"',
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Fallback list busy blocks also failed (${response.status}): ${errorText}`);
      return [];
    }

    const data = await response.json();
    this.logger.log(`Fallback found ${(data.value || []).length} busy block events`);
    return (data.value || []).map((e: any) => ({ id: e.id }));
  }

  async deleteEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
  ): Promise<void> {
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!response.ok && response.status !== 404) {
      this.logger.error(`Failed to delete event ${eventId}: ${response.status}`);
    }
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
      subject: title,
      body: {
        contentType: 'Text',
        content: `Synced by Bolo from ${sourceCalendarName}`,
      },
      start: {
        dateTime: startTime.toISOString().replace('Z', ''),
        timeZone: 'UTC',
      },
      end: {
        dateTime: endTime.toISOString().replace('Z', ''),
        timeZone: 'UTC',
      },
      showAs: 'busy',
      sensitivity: 'private',
      categories: ['Bolo Busy Block'],
    };

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/events`,
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

  async getFreeBusy(
    accessToken: string,
    calendarIds: string[],
    timeMin: Date,
    timeMax: Date,
  ): Promise<Map<string, Array<{ start: Date; end: Date }>>> {
    const result = new Map<string, Array<{ start: Date; end: Date }>>();

    for (const calendarId of calendarIds) {
      try {
        const params = new URLSearchParams({
          startDateTime: timeMin.toISOString(),
          endDateTime: timeMax.toISOString(),
          $select: 'start,end,showAs,isAllDay,isCancelled',
          $orderby: 'start/dateTime',
          $top: '500',
        });

        const response = await fetch(
          `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/calendarView?${params}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Prefer: 'outlook.timezone="UTC"',
            },
          },
        );

        if (!response.ok) {
          this.logger.error(`Microsoft free/busy failed for calendar ${calendarId}: ${response.status}`);
          continue;
        }

        const data = await response.json();
        const busyPeriods: Array<{ start: Date; end: Date }> = [];

        for (const event of data.value || []) {
          if (event.isCancelled) continue;
          if (event.showAs === 'free') continue;
          if (event.isAllDay) continue;

          busyPeriods.push({
            start: this.parseMicrosoftDateTime(event.start),
            end: this.parseMicrosoftDateTime(event.end),
          });
        }

        result.set(calendarId, busyPeriods);
      } catch (err) {
        this.logger.error(`Error getting free/busy for Microsoft calendar ${calendarId}: ${err}`);
      }
    }

    return result;
  }

  async refreshToken(refreshToken: string) {
    const clientId = this.configService.get('MICROSOFT_CLIENT_ID');
    const clientSecret = this.configService.get('MICROSOFT_CLIENT_SECRET');

    this.logger.log(`Refreshing Microsoft token (clientId: ${clientId?.substring(0, 10)}...)`);

    const response = await fetch(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      },
    );

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

  private parseMicrosoftDateTime(dt: { dateTime: string; timeZone: string }): Date {
    // Microsoft returns datetime in the calendar's timezone
    // We'll parse it and convert to UTC
    const dateStr = dt.dateTime;
    // Microsoft returns format like "2024-01-15T09:00:00.0000000"
    return new Date(dateStr + 'Z');
  }

  private mapShowAs(showAs: string): string {
    switch (showAs) {
      case 'free':
        return 'FREE';
      case 'tentative':
        return 'TENTATIVE';
      case 'oof':
        return 'OOO';
      case 'busy':
      case 'workingElsewhere':
      default:
        return 'BUSY';
    }
  }

  private mapMicrosoftColor(color: string): string {
    // Microsoft uses named colors, map to hex
    const colorMap: Record<string, string> = {
      auto: '#0078d4',
      lightBlue: '#71afe5',
      lightGreen: '#7ed321',
      lightOrange: '#ffaa44',
      lightGray: '#a0aeb2',
      lightYellow: '#fff100',
      lightTeal: '#00d1c1',
      lightPink: '#ff69b4',
      lightBrown: '#a52a2a',
      lightRed: '#e74856',
      maxColor: '#0078d4',
    };
    return colorMap[color] || '#0078d4';
  }
}
