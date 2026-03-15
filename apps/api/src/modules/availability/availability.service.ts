import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleCalendarProvider } from '../../providers/google/google-calendar.provider';
import { MicrosoftCalendarProvider } from '../../providers/microsoft/microsoft-calendar.provider';
import {
  SlotFinderService,
  BusyPeriod,
  ParticipantAvailability,
  CommonSlot,
} from './slot-finder.service';

@Injectable()
export class AvailabilityService {
  private readonly logger = new Logger(AvailabilityService.name);

  constructor(
    private prisma: PrismaService,
    private slotFinder: SlotFinderService,
    private googleCalendarProvider: GoogleCalendarProvider,
    private microsoftCalendarProvider: MicrosoftCalendarProvider,
  ) {}

  /**
   * Get availability for a user by their @handle.
   * Uses Free/Busy APIs - we only see WHEN they're busy, not WHAT the events are.
   */
  async getAvailabilityByHandle(
    handle: string,
    startDate: Date,
    endDate: Date,
    timezone: string = 'UTC',
    connectionId?: string,
  ): Promise<{ busyPeriods: BusyPeriod[]; timezone: string }> {
    // Remove @ prefix if present
    const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle;

    const user = await this.prisma.user.findUnique({
      where: { handle: cleanHandle },
      include: {
        calendarConnections: {
          where: {
            isEnabled: true,
            ...(connectionId ? { id: connectionId } : {}),
          },
          include: {
            calendars: { where: { isSelected: true } },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Handle not found');
    }

    // Collect all busy times from all connected calendars
    const busyPeriods: BusyPeriod[] = [];

    for (const connection of user.calendarConnections) {
      let accessToken = connection.accessToken;

      // Refresh token if expired
      if (connection.expiresAt && connection.expiresAt < new Date() && connection.refreshToken) {
        try {
          const provider = connection.provider === 'MICROSOFT'
            ? this.microsoftCalendarProvider
            : this.googleCalendarProvider;
          const newTokens = await provider.refreshToken(connection.refreshToken);
          accessToken = newTokens.accessToken;
          await this.prisma.calendarConnection.update({
            where: { id: connection.id },
            data: { accessToken: newTokens.accessToken, expiresAt: newTokens.expiresAt },
          });
        } catch (err) {
          this.logger.error(`Failed to refresh ${connection.provider} token for ${user.handle}: ${err}`);
          continue;
        }
      }

      if (!accessToken) continue;

      // Get calendar IDs to check
      const calendarIds = connection.calendars.length > 0
        ? connection.calendars.map(c => c.externalId)
        : ['primary'];

      try {
        let busyMap: Map<string, Array<{ start: Date; end: Date }>>;

        if (connection.provider === 'MICROSOFT') {
          busyMap = await this.microsoftCalendarProvider.getFreeBusy(
            accessToken,
            calendarIds,
            startDate,
            endDate,
          );
        } else {
          // Default to Google
          busyMap = await this.googleCalendarProvider.getFreeBusy(
            accessToken,
            calendarIds,
            startDate,
            endDate,
          );
        }

        // Collect busy periods from all calendars
        for (const [, periods] of busyMap) {
          for (const period of periods) {
            busyPeriods.push({
              startTime: period.start,
              endTime: period.end,
              source: connection.provider,
            });
          }
        }

        this.logger.log(`@${cleanHandle}: Found ${busyPeriods.length} busy blocks via ${connection.provider} Free/Busy`);
      } catch (err) {
        this.logger.error(`Failed to get free/busy for @${cleanHandle} (${connection.provider}): ${err}`);
      }
    }

    return { busyPeriods, timezone: user.timezone };
  }

  async findMutualAvailability(
    handles: string[],
    startDate: Date,
    endDate: Date,
    duration: number,
    timezone: string = 'UTC',
  ): Promise<CommonSlot[]> {
    // Get availability for each handle
    const participantAvailabilities: ParticipantAvailability[] =
      await Promise.all(
        handles.map(async (handle, index) => {
          const availability = await this.getAvailabilityByHandle(
            handle,
            startDate,
            endDate,
            timezone,
          );
          return {
            participantId: `participant-${index}`,
            email: handle,
            busyPeriods: availability.busyPeriods,
            timezone: availability.timezone,
          };
        }),
      );

    // Find common slots using the slot finder
    return this.slotFinder.findCommonSlots(participantAvailabilities, {
      duration,
      dateRangeStart: startDate,
      dateRangeEnd: endDate,
      timezone,
    });
  }
}
