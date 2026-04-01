import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { AvailabilityService } from '../availability/availability.service';
import { SlotFinderService, ParticipantAvailability } from '../availability/slot-finder.service';
import { EmailService, escapeHtml } from '../email/email.service';
import { GoogleCalendarProvider } from '../../providers/google/google-calendar.provider';
import { MicrosoftCalendarProvider } from '../../providers/microsoft/microsoft-calendar.provider';
import { ContactsService } from '../contacts/contacts.service';
import { CreateBookingDto } from './dto/create-booking.dto';

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);
  private readonly appUrl: string;

  constructor(
    private prisma: PrismaService,
    private availabilityService: AvailabilityService,
    private slotFinder: SlotFinderService,
    private emailService: EmailService,
    private configService: ConfigService,
    private googleCalendarProvider: GoogleCalendarProvider,
    private microsoftCalendarProvider: MicrosoftCalendarProvider,
    private contactsService: ContactsService,
  ) {
    this.appUrl = this.configService.get<string>('APP_URL') || 'https://bolospot.com';
  }

  async getPublicProfile(handle: string, profileSlug?: string) {
    const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle;

    const user = await this.prisma.user.findUnique({
      where: { handle: cleanHandle },
      select: {
        handle: true,
        name: true,
        timezone: true,
        isHumanVerified: true,
        verificationLevel: true,
        workingHoursStart: true,
        workingHoursEnd: true,
        workingDays: true,
        bookingProfiles: {
          where: {
            isActive: true,
            visibility: 'PUBLIC',
            ...(profileSlug ? { slug: profileSlug } : {}),
          },
          ...(profileSlug ? {} : { take: 1, orderBy: { createdAt: 'asc' as const } }),
          select: {
            slug: true,
            name: true,
            description: true,
            durations: true,
            bufferBefore: true,
            bufferAfter: true,
            connectionId: true,
            customHoursStart: true,
            customHoursEnd: true,
            customDays: true,
            connection: { select: { id: true, accountEmail: true, provider: true } },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const profile = user.bookingProfiles[0] || null;

    return {
      handle: user.handle,
      name: user.name,
      timezone: user.timezone,
      isHumanVerified: user.isHumanVerified,
      verificationLevel: user.verificationLevel,
      workingHoursStart: user.workingHoursStart,
      workingHoursEnd: user.workingHoursEnd,
      workingDays: user.workingDays,
      bookingProfile: profile
        ? {
            slug: profile.slug,
            name: profile.name,
            description: profile.description,
            durations: profile.durations,
            bufferBefore: profile.bufferBefore,
            bufferAfter: profile.bufferAfter,
            isConnected: !!profile.connectionId,
            connectionId: profile.connectionId || undefined,
          }
        : null,
    };
  }

  async listPublicProfiles(handle: string) {
    const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle;

    const user = await this.prisma.user.findUnique({
      where: { handle: cleanHandle },
      select: {
        handle: true,
        name: true,
        timezone: true,
        bookingProfiles: {
          where: { isActive: true, visibility: 'PUBLIC' },
          orderBy: { createdAt: 'asc' },
          select: {
            slug: true,
            name: true,
            description: true,
            durations: true,
            connectionId: true,
            connection: { select: { id: true, accountEmail: true, provider: true } },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      handle: user.handle,
      name: user.name,
      profiles: user.bookingProfiles.map((p) => ({
        slug: p.slug,
        name: p.name,
        description: p.description,
        durations: p.durations,
        isConnected: !!p.connectionId,
      })),
    };
  }

  /**
   * Validate that a handle exists and has a public booking profile.
   */
  async validateHandle(handle: string) {
    const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle;

    const user = await this.prisma.user.findUnique({
      where: { handle: cleanHandle },
      select: {
        handle: true,
        name: true,
        isHumanVerified: true,
        bookingProfiles: {
          where: { isActive: true, visibility: 'PUBLIC' },
          take: 1,
        },
      },
    });

    if (!user) {
      return { valid: false, handle: cleanHandle, name: null, isHumanVerified: false, reason: 'not_found' };
    }

    if (user.bookingProfiles.length === 0) {
      return { valid: false, handle: user.handle, name: user.name, isHumanVerified: user.isHumanVerified, reason: 'booking_disabled' };
    }

    return { valid: true, handle: user.handle, name: user.name, isHumanVerified: user.isHumanVerified };
  }

  /**
   * Resolve an email address to a Bolo user with a public booking profile.
   */
  async resolveEmail(hostHandle: string, email: string) {
    const cleanHost = hostHandle.startsWith('@') ? hostHandle.slice(1) : hostHandle;
    const normalizedEmail = email.trim().toLowerCase();

    // Check primary email
    let user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        handle: true,
        name: true,
        isHumanVerified: true,
        bookingProfiles: {
          where: { isActive: true, visibility: 'PUBLIC' },
          take: 1,
        },
      },
    });

    // Check secondary emails
    if (!user) {
      const userEmail = await this.prisma.userEmail.findUnique({
        where: { email: normalizedEmail },
        include: {
          user: {
            select: {
              handle: true,
              name: true,
              isHumanVerified: true,
              bookingProfiles: {
                where: { isActive: true, visibility: 'PUBLIC' },
                take: 1,
              },
            },
          },
        },
      });
      user = userEmail?.user || null;
    }

    if (!user) {
      return { found: false };
    }

    // Don't resolve to the host
    if (user.handle.toLowerCase() === cleanHost.toLowerCase()) {
      return { found: false, reason: 'host' };
    }

    // Check they have a booking profile
    if (user.bookingProfiles.length === 0) {
      return { found: false, reason: 'no_booking_profile' };
    }

    return {
      found: true,
      handle: user.handle,
      name: user.name,
      isHumanVerified: user.isHumanVerified,
    };
  }

  async getAvailableSlots(
    handle: string,
    date: string,
    duration: number,
    timezone?: string,
    additionalHandles?: string[],
    visitorBusyPeriods?: { startTime: Date; endTime: Date; source: string }[],
    connectionId?: string,
  ) {
    const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle;

    // Load user with booking profile
    const user = await this.prisma.user.findUnique({
      where: { handle: cleanHandle },
      include: {
        bookingProfiles: {
          where: { isActive: true, visibility: 'PUBLIC' },
          take: 1,
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const profile = user.bookingProfiles[0];
    if (!profile) {
      throw new BadRequestException('Booking is not available for this user');
    }

    // Validate duration is allowed
    if (!profile.durations.includes(duration)) {
      throw new BadRequestException(
        `Duration ${duration} is not available. Allowed: ${profile.durations.join(', ')} minutes`,
      );
    }

    const userTimezone = timezone || user.timezone;

    // Build date range for the requested day
    const dayStart = DateTime.fromISO(date, { zone: userTimezone }).startOf('day');
    const dayEnd = dayStart.endOf('day');

    // Use working hours from booking profile (or user defaults)
    const workingHoursStart = profile.customHoursStart ?? user.workingHoursStart;
    const workingHoursEnd = profile.customHoursEnd ?? user.workingHoursEnd;
    const workingDays = profile.customDays.length > 0 ? profile.customDays : user.workingDays;

    // Build participant availability array
    const participants: ParticipantAvailability[] = [];
    const participantInfo: { id: string; handle: string; name: string | null }[] = [];

    // 1. Host's busy periods (scoped to connection if per-calendar profile)
    const { busyPeriods: hostBusy } = await this.availabilityService.getAvailabilityByHandle(
      cleanHandle,
      dayStart.toJSDate(),
      dayEnd.toJSDate(),
      userTimezone,
      connectionId,
    );

    participants.push({
      participantId: user.id,
      email: user.handle,
      busyPeriods: hostBusy,
      timezone: userTimezone,
    });
    participantInfo.push({ id: user.id, handle: user.handle, name: user.name });

    // 2. Additional handles' busy periods (validate each has a public profile)
    const cleanAdditionalHandles = (additionalHandles || [])
      .map(h => h.startsWith('@') ? h.slice(1) : h)
      .filter(h => h && h !== cleanHandle)
      .slice(0, 5);

    for (const addHandle of cleanAdditionalHandles) {
      try {
        const validation = await this.validateHandle(addHandle);
        if (!validation.valid) {
          this.logger.log(`Skipping @${addHandle}: ${validation.reason}`);
          continue;
        }

        const { busyPeriods } = await this.availabilityService.getAvailabilityByHandle(
          addHandle,
          dayStart.toJSDate(),
          dayEnd.toJSDate(),
          userTimezone,
        );

        const addUser = await this.prisma.user.findUnique({
          where: { handle: addHandle },
          select: { id: true, handle: true, name: true },
        });

        if (addUser) {
          participants.push({
            participantId: addUser.id,
            email: addUser.handle,
            busyPeriods,
            timezone: userTimezone,
          });
          participantInfo.push({ id: addUser.id, handle: addUser.handle, name: addUser.name });
        }
      } catch (err) {
        this.logger.error(`Failed to get availability for @${addHandle}: ${err}`);
      }
    }

    // 3. Visitor's busy periods (from visitor OAuth session)
    if (visitorBusyPeriods && visitorBusyPeriods.length > 0) {
      participants.push({
        participantId: 'visitor',
        email: 'visitor',
        busyPeriods: visitorBusyPeriods,
        timezone: userTimezone,
      });
      participantInfo.push({ id: 'visitor', handle: 'visitor', name: 'You' });
    }

    // Find available slots — show ALL slots where the host is free (minParticipants: 1)
    const slots = this.slotFinder.findCommonSlots(
      participants,
      {
        duration,
        dateRangeStart: dayStart.toJSDate(),
        dateRangeEnd: dayEnd.toJSDate(),
        timezone: userTimezone,
        workingHoursOnly: true,
        workingHoursStart,
        workingHoursEnd,
        workingDays,
        bufferBefore: profile.bufferBefore,
        bufferAfter: profile.bufferAfter,
        slotIncrement: duration >= 30 ? 30 : 15,
        limit: 100,
        minParticipants: 1,
      },
    );

    // Filter: host must be available
    const hostId = user.id;
    const hostAvailableSlots = slots.filter(
      slot => slot.availableParticipantIds.includes(hostId),
    );

    // Filter out past slots
    const now = new Date();
    const futureSlots = hostAvailableSlots.filter((slot) => slot.startTime > now);

    // Map participant IDs back to handles
    const idToHandle = new Map(participantInfo.map(p => [p.id, p.handle]));
    const hasMultipleParticipants = participants.length > 1;

    return {
      date,
      timezone: userTimezone,
      participants: participantInfo.map(p => ({ handle: p.handle, name: p.name })),
      slots: futureSlots.map((slot) => ({
        startTime: slot.startTime.toISOString(),
        endTime: slot.endTime.toISOString(),
        ...(hasMultipleParticipants ? {
          score: slot.score,
          availableFor: slot.availableParticipantIds
            .map(id => idToHandle.get(id))
            .filter(Boolean),
          unavailableFor: slot.unavailableParticipantIds
            .map(id => idToHandle.get(id))
            .filter(Boolean),
        } : {}),
      })),
    };
  }

  async createBooking(
    handle: string,
    dto: CreateBookingDto,
    bookingTier: 'direct' | 'approval' = 'direct',
    visitorHandle?: string | null,
  ) {
    const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle;

    // Load user with booking profile and calendar connections
    const user = await this.prisma.user.findUnique({
      where: { handle: cleanHandle },
      include: {
        bookingProfiles: {
          where: {
            isActive: true,
            visibility: 'PUBLIC',
            ...(dto.profileSlug ? { slug: dto.profileSlug } : {}),
          },
          ...(dto.profileSlug ? {} : { take: 1, orderBy: { createdAt: 'asc' as const } }),
        },
        calendarConnections: {
          where: { isEnabled: true },
          include: {
            calendars: { where: { isPrimary: true } },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const profile = user.bookingProfiles[0];
    if (!profile) {
      throw new BadRequestException('Booking is not available for this user');
    }

    // Ensure name and email are present (auto-filled by controller for API key users)
    if (!dto.email) {
      throw new BadRequestException('Email is required for booking');
    }
    if (!dto.name) {
      throw new BadRequestException('Name is required for booking');
    }
    const bookerEmail: string = dto.email;
    const bookerName: string = dto.name;

    // Validate duration
    if (!profile.durations.includes(dto.duration)) {
      throw new BadRequestException(
        `Duration ${dto.duration} is not available. Allowed: ${profile.durations.join(', ')} minutes`,
      );
    }

    // Check contact frequency limits (host's rules for this visitor)
    if (visitorHandle) {
      const visitorUser = await this.prisma.user.findUnique({
        where: { handle: visitorHandle.startsWith('@') ? visitorHandle.slice(1) : visitorHandle },
        select: { id: true },
      });
      if (visitorUser) {
        const constraints = await this.contactsService.checkMeetingConstraints(
          user.id, visitorUser.id, visitorHandle, dto.duration,
        );
        if (!constraints.allowed) {
          throw new BadRequestException(constraints.reason);
        }
      }
    }

    const startTime = new Date(dto.startTime);
    const endTime = new Date(startTime.getTime() + dto.duration * 60 * 1000);

    // Validate the slot isn't in the past
    if (startTime < new Date()) {
      throw new BadRequestException('Cannot book a time in the past');
    }

    // Re-verify the slot is still available for the host
    const dayStart = DateTime.fromJSDate(startTime, { zone: dto.timezone }).startOf('day');
    const dayEnd = dayStart.endOf('day');

    const { busyPeriods } = await this.availabilityService.getAvailabilityByHandle(
      cleanHandle,
      dayStart.toJSDate(),
      dayEnd.toJSDate(),
      dto.timezone,
      profile.connectionId || undefined,
    );

    const isStillAvailable = !busyPeriods.some((busy) => {
      const busyStart = busy.startTime.getTime();
      const busyEnd = busy.endTime.getTime();
      const slotStart = startTime.getTime();
      const slotEnd = endTime.getTime();
      return slotStart < busyEnd && slotEnd > busyStart;
    });

    if (!isStillAvailable) {
      throw new BadRequestException('This time slot is no longer available. Please choose another time.');
    }

    // Generate a share code
    const shareCode = this.generateShareCode();

    // Build participant list: email-only attendees
    const additionalEmails = (dto.additionalAttendees || [])
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e && e !== bookerEmail.toLowerCase() && e !== user.email.toLowerCase());

    // Resolve additional Bolo handles
    const additionalHandleUsers: Array<{
      id: string; handle: string; name: string | null; email: string;
      connection: {
        id: string; provider: string; accessToken: string;
        refreshToken: string | null; expiresAt: Date | null;
        calendars: Array<{ externalId: string }>;
      } | null;
    }> = [];

    const cleanAdditionalHandles = (dto.additionalHandles || [])
      .map(h => h.startsWith('@') ? h.slice(1) : h)
      .filter(h => h && h !== cleanHandle)
      .slice(0, 5);

    const invalidHandles: Array<{ handle: string; reason: string }> = [];

    for (const addHandle of cleanAdditionalHandles) {
      const addUser = await this.prisma.user.findUnique({
        where: { handle: addHandle },
        include: {
          bookingProfiles: {
            where: { isActive: true, visibility: 'PUBLIC' },
            take: 1,
          },
          calendarConnections: {
            where: { isEnabled: true },
            include: { calendars: { where: { isPrimary: true } } },
          },
        },
      });

      if (!addUser) {
        invalidHandles.push({ handle: addHandle, reason: 'User not found' });
        continue;
      }

      if (addUser.bookingProfiles.length === 0) {
        invalidHandles.push({ handle: addHandle, reason: 'No public booking profile' });
        continue;
      }

      if (addUser && addUser.bookingProfiles.length > 0) {
        additionalHandleUsers.push({
          id: addUser.id,
          handle: addUser.handle,
          name: addUser.name,
          email: addUser.email,
          connection: addUser.calendarConnections[0]?.accessToken
            ? {
                id: addUser.calendarConnections[0].id,
                provider: addUser.calendarConnections[0].provider,
                accessToken: addUser.calendarConnections[0].accessToken!,
                refreshToken: addUser.calendarConnections[0].refreshToken,
                expiresAt: addUser.calendarConnections[0].expiresAt,
                calendars: addUser.calendarConnections[0].calendars.map(c => ({ externalId: c.externalId })),
              }
            : null,
        });
      }
    }

    // Dedupe all attendee emails
    const allHandleEmails = additionalHandleUsers.map(u => u.email.toLowerCase());
    const allUniqueEmails = [...new Set([
      ...additionalEmails,
      ...allHandleEmails,
    ])].filter(e => e !== bookerEmail.toLowerCase() && e !== user.email.toLowerCase());

    const participantCreates = [
      {
        email: user.email,
        name: user.name,
        userId: user.id,
        role: 'ORGANIZER' as const,
        responseStatus: 'RESPONDED' as const,
        respondedAt: new Date(),
        invitationStatus: 'APPROVED' as const,
      },
      {
        email: bookerEmail,
        name: bookerName,
        role: 'INVITEE' as const,
        responseStatus: 'RESPONDED' as const,
        respondedAt: new Date(),
        invitationStatus: 'APPROVED' as const,
      },
      ...additionalHandleUsers.map(u => ({
        email: u.email,
        name: u.name,
        userId: u.id,
        role: 'INVITEE' as const,
        responseStatus: 'RESPONDED' as const,
        respondedAt: new Date(),
        invitationStatus: 'APPROVED' as const,
      })),
      ...additionalEmails
        .filter(email => !allHandleEmails.includes(email))
        .map((email) => ({
          email,
          name: email.split('@')[0],
          role: 'INVITEE' as const,
          responseStatus: 'NOT_RESPONDED' as const,
          respondedAt: null as Date | null,
          invitationStatus: 'APPROVED' as const,
        })),
    ];

    // Meeting title
    const handleNames = additionalHandleUsers.map(u => u.name || `@${u.handle}`);
    const title = handleNames.length > 0
      ? `Meeting with ${bookerName}, ${handleNames.join(', ')}`
      : `Meeting with ${bookerName}`;

    // Create the meeting request — PENDING if approval required, CONFIRMED if direct
    const isPending = bookingTier === 'approval';
    const meeting = await this.prisma.meetingRequest.create({
      data: {
        organizerId: user.id,
        title,
        description: dto.notes || null,
        duration: dto.duration,
        dateRangeStart: startTime,
        dateRangeEnd: endTime,
        timezone: dto.timezone,
        status: isPending ? 'PENDING' : 'CONFIRMED',
        confirmedStartTime: isPending ? null : startTime,
        confirmedEndTime: isPending ? null : endTime,
        shareCode,
        workflow: isPending ? 'APPROVAL' : 'AUTO',
        participants: {
          create: participantCreates,
        },
      },
    });

    // Format time for emails
    const formattedTime = DateTime.fromJSDate(startTime, { zone: dto.timezone })
      .toFormat('cccc, LLLL d, yyyy \'at\' h:mm a ZZZZ');

    const handleLabel = additionalHandleUsers.length > 0
      ? ` and ${additionalHandleUsers.map(u => `@${u.handle}`).join(', ')}`
      : '';

    let meetingLink: string | null = null;

    if (!isPending) {
      // ─── DIRECT BOOKING: create calendar events + send confirmation emails ───

      const allAttendeeEmails = [bookerEmail, ...allUniqueEmails];

      // Use the profile's specific connection, or fall back to first
      const connection = profile.connectionId
        ? user.calendarConnections.find(c => c.id === profile.connectionId) || user.calendarConnections[0]
        : user.calendarConnections[0];
      if (connection?.accessToken) {
        meetingLink = await this.createCalendarEvent(
          { ...connection, accessToken: connection.accessToken },
          title, dto.notes, startTime, endTime,
          allAttendeeEmails, meeting.id, true,
        );

        if (meetingLink) {
          await this.prisma.meetingRequest.update({
            where: { id: meeting.id },
            data: { meetingLink },
          });
        }
      }

      for (const addUser of additionalHandleUsers) {
        if (!addUser.connection) continue;
        await this.createCalendarEvent(
          addUser.connection, title, dto.notes, startTime, endTime,
          allAttendeeEmails, meeting.id, false,
        );
        this.logger.log(`Created calendar event for @${addUser.handle}`);
      }

      // Escape user-controlled values for HTML emails
      const safeName = escapeHtml(bookerName);
      const safeEmail = escapeHtml(bookerEmail);
      const safeNotes = dto.notes ? escapeHtml(dto.notes) : '';
      const safeHostName = escapeHtml(user.name || user.handle);
      const safeHostHandle = escapeHtml(user.handle);
      const safeHandleLabel = escapeHtml(handleLabel);

      // Confirmation email to visitor
      await this.emailService.sendEmail({
        to: bookerEmail,
        subject: `Meeting confirmed with ${user.name || user.handle}${handleLabel}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #0ea5e9;">Meeting Confirmed!</h2>
            <p>Hi ${safeName},</p>
            <p>Your meeting has been booked successfully.</p>
            <div style="background: #f8fafc; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <p style="margin: 4px 0;"><strong>Meeting with:</strong> ${safeHostName} (@${safeHostHandle})${safeHandleLabel}</p>
              <p style="margin: 4px 0;"><strong>When:</strong> ${formattedTime}</p>
              <p style="margin: 4px 0;"><strong>Duration:</strong> ${dto.duration} minutes</p>
              ${meetingLink ? `<p style="margin: 4px 0;"><strong>Meeting link:</strong> <a href="${meetingLink}">${escapeHtml(meetingLink)}</a></p>` : ''}
              ${safeNotes ? `<p style="margin: 4px 0;"><strong>Notes:</strong> ${safeNotes}</p>` : ''}
            </div>
            ${meetingLink ? `<p style="text-align: center; margin: 30px 0;"><a href="${meetingLink}" style="background: #0ea5e9; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px;">Join Meeting</a></p>` : ''}
            <p style="color: #94a3b8; font-size: 14px;">Scheduled via <a href="${this.appUrl}" style="color: #0ea5e9;">Bolo</a></p>
          </div>
        `,
      });

      // Confirmation email to host
      await this.emailService.sendEmail({
        to: user.email,
        subject: `New booking: ${bookerName} booked a meeting`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #0ea5e9;">New Meeting Booked</h2>
            <p>Hi ${safeHostName},</p>
            <p>Someone booked a meeting on your Bolo page.</p>
            <div style="background: #f8fafc; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <p style="margin: 4px 0;"><strong>Booked by:</strong> ${safeName} (${safeEmail})</p>
              <p style="margin: 4px 0;"><strong>When:</strong> ${formattedTime}</p>
              <p style="margin: 4px 0;"><strong>Duration:</strong> ${dto.duration} minutes</p>
              ${additionalHandleUsers.length > 0 ? `<p style="margin: 4px 0;"><strong>Also invited:</strong> ${additionalHandleUsers.map(u => `@${escapeHtml(u.handle)}`).join(', ')}</p>` : ''}
              ${safeNotes ? `<p style="margin: 4px 0;"><strong>Notes:</strong> ${safeNotes}</p>` : ''}
            </div>
            <p style="text-align: center; margin: 30px 0;">
              <a href="${this.appUrl}/dashboard/meetings" style="background: #0ea5e9; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px;">View in Dashboard</a>
            </p>
          </div>
        `,
      });

      // Confirmation email to additional Bolo handle users
      for (const addUser of additionalHandleUsers) {
        const safeAddName = escapeHtml(addUser.name || addUser.handle);
        await this.emailService.sendEmail({
          to: addUser.email,
          subject: `You've been added to a meeting with ${bookerName}`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #0ea5e9;">New Meeting</h2>
              <p>Hi ${safeAddName},</p>
              <p>${safeName} booked a meeting that includes you.</p>
              <div style="background: #f8fafc; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <p style="margin: 4px 0;"><strong>Booked by:</strong> ${safeName} (${safeEmail})</p>
                <p style="margin: 4px 0;"><strong>Host:</strong> @${safeHostHandle}</p>
                <p style="margin: 4px 0;"><strong>When:</strong> ${formattedTime}</p>
                <p style="margin: 4px 0;"><strong>Duration:</strong> ${dto.duration} minutes</p>
                ${meetingLink ? `<p style="margin: 4px 0;"><strong>Meeting link:</strong> <a href="${meetingLink}">${escapeHtml(meetingLink)}</a></p>` : ''}
              </div>
              ${meetingLink ? `<p style="text-align: center; margin: 30px 0;"><a href="${meetingLink}" style="background: #0ea5e9; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px;">Join Meeting</a></p>` : ''}
              <p style="text-align: center;">
                <a href="${this.appUrl}/dashboard/meetings" style="color: #0ea5e9;">View in Dashboard</a>
              </p>
            </div>
          `,
        });
      }
    } else {
      // ─── APPROVAL REQUIRED: send request emails, no calendar events yet ───

      const safeVisitorHandle = visitorHandle ? escapeHtml(visitorHandle) : '';
      const visitorLabel = safeVisitorHandle ? ` (@${safeVisitorHandle})` : '';
      const safeName2 = escapeHtml(bookerName);
      const safeEmail2 = escapeHtml(bookerEmail);
      const safeNotes2 = dto.notes ? escapeHtml(dto.notes) : '';
      const safeHostName2 = escapeHtml(user.name || user.handle);
      const safeHostHandle2 = escapeHtml(user.handle);

      // Request email to host
      await this.emailService.sendEmail({
        to: user.email,
        subject: `Meeting request from ${bookerName}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #f59e0b;">Meeting Request</h2>
            <p>Hi ${safeHostName2},</p>
            <p>${safeName2}${visitorLabel} wants to meet with you.</p>
            <div style="background: #fffbeb; border-radius: 8px; padding: 20px; margin: 20px 0; border: 1px solid #fde68a;">
              <p style="margin: 4px 0;"><strong>From:</strong> ${safeName2} (${safeEmail2})${visitorLabel}</p>
              <p style="margin: 4px 0;"><strong>Requested time:</strong> ${formattedTime}</p>
              <p style="margin: 4px 0;"><strong>Duration:</strong> ${dto.duration} minutes</p>
              ${safeNotes2 ? `<p style="margin: 4px 0;"><strong>Notes:</strong> ${safeNotes2}</p>` : ''}
            </div>
            <p style="text-align: center; margin: 30px 0;">
              <a href="${this.appUrl}/dashboard/meetings" style="background: #f59e0b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px;">Review Request</a>
            </p>
          </div>
        `,
      });

      // Pending confirmation email to visitor
      await this.emailService.sendEmail({
        to: bookerEmail,
        subject: `Meeting request sent to ${user.name || user.handle}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #f59e0b;">Request Sent</h2>
            <p>Hi ${safeName2},</p>
            <p>Your meeting request has been sent to ${safeHostName2} (@${safeHostHandle2}). They'll review it and you'll be notified when they respond.</p>
            <div style="background: #fffbeb; border-radius: 8px; padding: 20px; margin: 20px 0; border: 1px solid #fde68a;">
              <p style="margin: 4px 0;"><strong>Requested time:</strong> ${formattedTime}</p>
              <p style="margin: 4px 0;"><strong>Duration:</strong> ${dto.duration} minutes</p>
            </div>
            <p style="color: #94a3b8; font-size: 14px;">Scheduled via <a href="${this.appUrl}" style="color: #0ea5e9;">Bolo</a></p>
          </div>
        `,
      });
    }

    return {
      id: meeting.id,
      title: meeting.title,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      meetingLink,
      hostName: user.name || user.handle,
      hostHandle: user.handle,
      status: isPending ? 'PENDING' as const : 'CONFIRMED' as const,
      additionalHandles: additionalHandleUsers.map(u => ({
        handle: u.handle,
        name: u.name,
      })),
      ...(invalidHandles.length > 0 ? { invalidHandles } : {}),
      message: isPending
        ? 'Your meeting request has been sent! You\'ll be notified when the host responds.'
        : 'Your meeting has been booked!',
    };
  }

  /**
   * Create a calendar event on a user's connected calendar.
   * Returns the meeting link if video conference was created.
   */
  private async createCalendarEvent(
    conn: { id: string; provider: string; accessToken: string; refreshToken: string | null; expiresAt: Date | null; calendars: Array<{ externalId: string }> },
    title: string,
    notes: string | undefined | null,
    startTime: Date,
    endTime: Date,
    attendees: string[],
    meetingId: string,
    createVideoConference: boolean,
  ): Promise<string | null> {
    let accessToken = conn.accessToken;

    // Refresh token if needed
    if (conn.expiresAt && conn.expiresAt < new Date() && conn.refreshToken) {
      try {
        const provider = conn.provider === 'MICROSOFT'
          ? this.microsoftCalendarProvider
          : this.googleCalendarProvider;
        const newTokens = await provider.refreshToken(conn.refreshToken);
        accessToken = newTokens.accessToken;
        await this.prisma.calendarConnection.update({
          where: { id: conn.id },
          data: { accessToken: newTokens.accessToken, expiresAt: newTokens.expiresAt },
        });
      } catch (err) {
        this.logger.error(`Failed to refresh token: ${err}`);
        return null;
      }
    }

    const calendarId = conn.calendars[0]?.externalId || 'primary';
    const description = notes ? `${notes}\n\nBooked via Bolo` : 'Booked via Bolo';

    try {
      if (conn.provider === 'MICROSOFT') {
        const result = await this.microsoftCalendarProvider.createEvent(
          accessToken, calendarId,
          { title, description, startTime, endTime, attendees, boloMeetingId: meetingId, createVideoConference },
        );
        return result.meetLink;
      } else {
        const result = await this.googleCalendarProvider.createEvent(
          accessToken, calendarId,
          { title, description, startTime, endTime, attendees, boloMeetingId: meetingId, createVideoConference },
        );
        return result.meetLink;
      }
    } catch (err) {
      this.logger.error(`Failed to create calendar event: ${err}`);
      return null;
    }
  }

  /**
   * Update a user's first active booking profile.
   * Used by MCP/API-key endpoints to manage booking settings.
   */
  async listOwnerProfiles(userId: string) {
    const profiles = await this.prisma.bookingProfile.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'asc' },
      include: {
        connection: { select: { id: true, accountEmail: true, provider: true } },
      },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { handle: true },
    });

    return profiles.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      durations: p.durations,
      bufferBefore: p.bufferBefore,
      bufferAfter: p.bufferAfter,
      visibility: p.visibility,
      connectionEmail: p.connection?.accountEmail || null,
      connectionProvider: p.connection?.provider || null,
      bookingUrl: user ? `bolospot.com/b/${user.handle}/${p.slug}` : null,
    }));
  }

  async updateBookingProfile(userId: string, data: {
    durations?: number[];
    bufferBefore?: number;
    bufferAfter?: number;
    name?: string;
    description?: string;
    slug?: string;
    setDefault?: boolean;
  }, profileId?: string) {
    const profile = profileId
      ? await this.prisma.bookingProfile.findFirst({ where: { id: profileId, userId, isActive: true } })
      : await this.prisma.bookingProfile.findFirst({ where: { userId, isActive: true }, orderBy: { createdAt: 'asc' } });

    if (!profile) {
      throw new NotFoundException('No active booking profile found');
    }

    const updateData: Record<string, any> = {};
    if (data.durations !== undefined) updateData.durations = data.durations;
    if (data.bufferBefore !== undefined) updateData.bufferBefore = data.bufferBefore;
    if (data.bufferAfter !== undefined) updateData.bufferAfter = data.bufferAfter;
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;

    // Make this the default doorstep calendar — set PUBLIC, demote all others to PRIVATE
    if (data.setDefault) {
      await this.prisma.bookingProfile.updateMany({
        where: { userId, isActive: true, id: { not: profile.id } },
        data: { visibility: 'PRIVATE' },
      });
      updateData.visibility = 'PUBLIC';
    }

    // Handle slug change with validation
    if (data.slug !== undefined && data.slug !== profile.slug) {
      const cleanSlug = data.slug.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30);
      if (!cleanSlug) {
        throw new BadRequestException('Slug cannot be empty');
      }
      // Check uniqueness for this user
      const existing = await this.prisma.bookingProfile.findUnique({
        where: { userId_slug: { userId, slug: cleanSlug } },
      });
      if (existing && existing.id !== profile.id) {
        throw new BadRequestException('That booking link is already in use');
      }
      updateData.slug = cleanSlug;
    }

    const updated = await this.prisma.bookingProfile.update({
      where: { id: profile.id },
      data: updateData,
    });

    return {
      id: updated.id,
      slug: updated.slug,
      name: updated.name,
      description: updated.description,
      durations: updated.durations,
      bufferBefore: updated.bufferBefore,
      bufferAfter: updated.bufferAfter,
    };
  }

  private generateShareCode(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }
}
