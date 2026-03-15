import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { MeetingsService } from '../meetings/meetings.service';

interface ManualAvailabilitySlot {
  startTime: string;
  endTime: string;
  preference?: 'AVAILABLE' | 'PREFERRED' | 'IF_NEEDED';
}

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => MeetingsService))
    private meetingsService: MeetingsService,
  ) {}

  async getInviteByToken(token: string) {
    const invitation = await this.prisma.invitationToken.findUnique({
      where: { token },
      include: {
        participant: {
          include: {
            meetingRequest: {
              include: {
                organizer: {
                  select: { id: true, handle: true, name: true },
                },
                participants: {
                  select: {
                    email: true,
                    name: true,
                    responseStatus: true,
                    user: {
                      select: { handle: true, name: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    // Check if expired
    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException('This invitation has expired');
    }

    // Check if already used
    if (invitation.usedAt) {
      throw new BadRequestException('This invitation has already been used');
    }

    const meeting = invitation.participant.meetingRequest;

    return {
      token: invitation.token,
      email: invitation.participant.email,
      expiresAt: invitation.expiresAt,
      meeting: {
        id: meeting.id,
        title: meeting.title,
        description: meeting.description,
        duration: meeting.duration,
        dateRangeStart: meeting.dateRangeStart,
        dateRangeEnd: meeting.dateRangeEnd,
        timezone: meeting.timezone,
        status: meeting.status,
        organizer: meeting.organizer,
        participantCount: meeting.participants.length,
      },
    };
  }

  async submitManualAvailability(
    token: string,
    slots: ManualAvailabilitySlot[],
    name?: string,
    userTimezone?: string,
  ) {
    const invitation = await this.prisma.invitationToken.findUnique({
      where: { token },
      include: {
        participant: {
          include: {
            meetingRequest: true,
          },
        },
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException('This invitation has expired');
    }

    if (invitation.usedAt) {
      throw new BadRequestException('This invitation has already been used');
    }

    const meeting = invitation.participant.meetingRequest;

    // Use the provided timezone, fall back to meeting timezone, then UTC
    const effectiveTimezone = userTimezone || meeting.timezone || 'UTC';
    this.logger.log(`Submitting availability in timezone: ${effectiveTimezone}`);

    // Convert slots from user's timezone to UTC for storage
    const convertedSlots = slots.map((slot) => {
      // Parse the time string in the user's timezone
      // If the string already has timezone info (ISO format with offset), parse directly
      // Otherwise, interpret it as local time in the user's timezone
      let startDt: DateTime;
      let endDt: DateTime;

      if (slot.startTime.includes('Z') || slot.startTime.match(/[+-]\d{2}:\d{2}$/)) {
        // ISO format with timezone - parse directly
        startDt = DateTime.fromISO(slot.startTime);
        endDt = DateTime.fromISO(slot.endTime);
      } else {
        // No timezone info - interpret as local time in user's timezone
        startDt = DateTime.fromISO(slot.startTime, { zone: effectiveTimezone });
        endDt = DateTime.fromISO(slot.endTime, { zone: effectiveTimezone });
      }

      if (!startDt.isValid || !endDt.isValid) {
        throw new BadRequestException(
          `Invalid time format: ${slot.startTime} or ${slot.endTime}`,
        );
      }

      // Convert to UTC for storage
      const startUtc = startDt.toUTC().toJSDate();
      const endUtc = endDt.toUTC().toJSDate();

      this.logger.log(
        `Slot converted: ${slot.startTime} (${effectiveTimezone}) -> ${startUtc.toISOString()} (UTC)`,
      );

      return {
        startTime: startUtc,
        endTime: endUtc,
        preference: slot.preference,
      };
    });

    // Validate slots are within the meeting date range (compare in UTC)
    for (const slot of convertedSlots) {
      if (slot.startTime < meeting.dateRangeStart || slot.endTime > meeting.dateRangeEnd) {
        throw new BadRequestException(
          'Availability slots must be within the meeting date range',
        );
      }
    }

    // Create availability slots and update participant
    await this.prisma.$transaction(async (tx) => {
      // Update participant name if provided
      if (name) {
        await tx.participant.update({
          where: { id: invitation.participantId },
          data: { name },
        });
      }

      // Create availability slots (stored in UTC)
      await tx.availabilitySlot.createMany({
        data: convertedSlots.map((slot) => ({
          participantId: invitation.participantId,
          startTime: slot.startTime,
          endTime: slot.endTime,
          timezone: effectiveTimezone, // Store original timezone for display purposes
          source: 'MANUAL',
          preference: slot.preference || 'AVAILABLE',
        })),
      });

      // Update participant response status
      await tx.participant.update({
        where: { id: invitation.participantId },
        data: {
          responseStatus: 'RESPONDED',
          respondedAt: new Date(),
        },
      });

      // Mark invitation as used
      await tx.invitationToken.update({
        where: { id: invitation.id },
        data: { usedAt: new Date() },
      });
    });

    // Try to auto-schedule the meeting now that we have availability
    await this.meetingsService.tryAutoSchedule(meeting.id);

    return {
      success: true,
      message: 'Availability submitted successfully',
    };
  }

  async declineInvitation(token: string) {
    const invitation = await this.prisma.invitationToken.findUnique({
      where: { token },
      include: { participant: true },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    await this.prisma.$transaction(async (tx) => {
      // Update participant status
      await tx.participant.update({
        where: { id: invitation.participantId },
        data: {
          responseStatus: 'DECLINED',
          respondedAt: new Date(),
        },
      });

      // Mark invitation as used
      await tx.invitationToken.update({
        where: { id: invitation.id },
        data: { usedAt: new Date() },
      });
    });

    return {
      success: true,
      message: 'Invitation declined',
    };
  }

  // Called after a non-user signs up and connects their calendar
  async linkParticipantToUser(token: string, userId: string) {
    const invitation = await this.prisma.invitationToken.findUnique({
      where: { token },
      include: { participant: true },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    // Link participant to the new user
    await this.prisma.participant.update({
      where: { id: invitation.participantId },
      data: {
        userId,
        useConnectedCalendar: true,
        responseStatus: 'RESPONDED',
        respondedAt: new Date(),
      },
    });

    // Mark invitation as used
    await this.prisma.invitationToken.update({
      where: { id: invitation.id },
      data: { usedAt: new Date() },
    });

    // Try to auto-schedule the meeting now that user has connected
    const participant = await this.prisma.participant.findUnique({
      where: { id: invitation.participantId },
      select: { meetingRequestId: true },
    });
    if (participant) {
      await this.meetingsService.tryAutoSchedule(participant.meetingRequestId);
    }

    return {
      success: true,
      message: 'Account connected successfully',
    };
  }
}
