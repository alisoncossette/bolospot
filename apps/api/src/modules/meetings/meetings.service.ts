import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { AvailabilityService } from '../availability/availability.service';
import { EmailService, escapeHtml } from '../email/email.service';
import { GoogleCalendarProvider } from '../../providers/google/google-calendar.provider';
import { MicrosoftCalendarProvider } from '../../providers/microsoft/microsoft-calendar.provider';
import { ContactsService } from '../contacts/contacts.service';

interface CreateMeetingDto {
  title: string;
  description?: string;
  duration: number;
  dateRangeStart: Date;
  dateRangeEnd: Date;
  timezone: string;
  timeRangeStart?: number; // Hour 0-23
  timeRangeEnd?: number;   // Hour 0-23
  participantEmails?: string[];
  participantHandles?: string[];
  participantPhones?: string[]; // Phone numbers - resolve to Bolo users if verified
  recordingPolicy?: string;
  preferredConnectionId?: string; // Calendar connection to use for creating event
  createVideoConference?: boolean; // Auto-generate Google Meet or Teams link (default true)
  workflow?: string; // AUTO = first available, MANUAL = see availability
}

interface BookMeetingDto {
  title: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  timezone: string;
  participantHandles: string[];
  participantEmails?: string[]; // Non-Bolo users by email
  location?: string;
}

@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);
  private readonly appUrl: string;

  constructor(
    private prisma: PrismaService,
    private availabilityService: AvailabilityService,
    private emailService: EmailService,
    private configService: ConfigService,
    private googleCalendarProvider: GoogleCalendarProvider,
    private microsoftCalendarProvider: MicrosoftCalendarProvider,
    private contactsService: ContactsService,
  ) {
    this.appUrl = this.configService.get<string>('APP_URL') || 'https://bolospot.com';
  }

  /**
   * Handle calendar token failure - mark connection as broken and notify user.
   */
  private async handleTokenFailure(
    connectionId: string,
    userId: string,
    errorMessage: string,
  ): Promise<void> {
    this.logger.warn(`Token failure for connection ${connectionId}: ${errorMessage}`);

    // Mark the connection as needing reconnection
    await this.prisma.calendarConnection.update({
      where: { id: connectionId },
      data: {
        syncStatus: 'ERROR',
        syncError: `Authentication failed. Please reconnect your calendar: ${errorMessage}`,
        isEnabled: false, // Disable until reconnected
      },
    });

    // Get user details for notification
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });

    if (user?.email) {
      // Send email notification about the connection failure
      try {
        await this.emailService.sendEmail({
          to: user.email,
          subject: 'Action Required: Reconnect Your Calendar',
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>Calendar Connection Issue</h2>
              <p>Hi${user.name ? ` ${escapeHtml(user.name)}` : ''},</p>
              <p>We were unable to access your calendar because your connection has expired or been revoked.</p>
              <p>Please reconnect your calendar to continue using Bolo's scheduling features:</p>
              <p style="text-align: center; margin: 30px 0;">
                <a href="${this.appUrl}/dashboard/settings" style="background: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px;">
                  Reconnect Calendar
                </a>
              </p>
              <p>If you have any questions, feel free to reach out.</p>
              <p>— The Bolo Team</p>
            </div>
          `,
        });
      } catch (emailErr) {
        this.logger.error(`Failed to send token failure notification: ${emailErr}`);
      }
    }
  }

  /**
   * Check for expired invitations and update their status.
   * Returns the count of newly expired participants.
   */
  async checkAndUpdateExpiredInvitations(meetingId: string): Promise<number> {
    const now = new Date();

    // Find participants with expired invitations who haven't responded
    const expiredParticipants = await this.prisma.participant.findMany({
      where: {
        meetingRequestId: meetingId,
        invitationExpiresAt: { lt: now },
        responseStatus: 'PENDING',
        role: 'INVITEE',
      },
    });

    if (expiredParticipants.length > 0) {
      // Mark them as EXPIRED
      await this.prisma.participant.updateMany({
        where: {
          id: { in: expiredParticipants.map(p => p.id) },
        },
        data: {
          responseStatus: 'EXPIRED',
          invitationStatus: 'EXPIRED',
        },
      });

      this.logger.log(`Marked ${expiredParticipants.length} participant(s) as EXPIRED for meeting ${meetingId}`);
    }

    return expiredParticipants.length;
  }

  async createMeeting(organizerId: string, dto: CreateMeetingDto) {
    this.logger.log(`Creating meeting with handles: ${JSON.stringify(dto.participantHandles)}, emails: ${JSON.stringify(dto.participantEmails)}`);

    // Get organizer info for emails
    const organizer = await this.prisma.user.findUnique({
      where: { id: organizerId },
      select: { id: true, handle: true, name: true, email: true },
    });

    if (!organizer) {
      throw new NotFoundException('Organizer not found');
    }

    // Check if organizer has a connected calendar - required for auto-scheduling
    const organizerCalendar = await this.prisma.calendarConnection.findFirst({
      where: {
        userId: organizerId,
        isEnabled: true,
      },
    });

    if (!organizerCalendar) {
      throw new BadRequestException(
        'You must connect a calendar before creating meetings. Go to Settings > Connections to connect your Google or Microsoft calendar.'
      );
    }

    // Resolve handles to users (check User.handle AND UserIdentity for BOLO_HANDLE)
    const handleUsers: Array<{ email: string; userId: string; name: string | null; handle: string; autoApprove: boolean }> = [];
    if (dto.participantHandles && dto.participantHandles.length > 0) {
      for (const handle of dto.participantHandles) {
        const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle;

        // First check User.handle directly
        let user = await this.prisma.user.findFirst({
          where: { handle: { equals: cleanHandle, mode: 'insensitive' } },
          select: { id: true, email: true, handle: true, name: true, autoApproveMeetings: true },
        });

        // If not found, check UserIdentity for BOLO_HANDLE
        if (!user) {
          const identity = await (this.prisma as any).userIdentity.findFirst({
            where: {
              value: { equals: cleanHandle.toLowerCase(), mode: 'insensitive' },
              identityType: { code: 'BOLO_HANDLE' },
            },
            include: {
              user: {
                select: { id: true, email: true, handle: true, name: true, autoApproveMeetings: true },
              },
            },
          });
          if (identity?.user) {
            user = identity.user;
            this.logger.log(`Handle @${cleanHandle} found via UserIdentity → user @${identity.user.handle}`);
          }
        }

        if (user) {
          handleUsers.push({
            email: user.email,
            userId: user.id,
            name: user.name,
            handle: user.handle,
            autoApprove: user.autoApproveMeetings,
          });
          this.logger.log(`Resolved @${cleanHandle} to user ${user.id} (${user.email}), autoApprove: ${user.autoApproveMeetings}`);
        } else {
          throw new NotFoundException(`User @${cleanHandle} not found. Please check the handle and try again.`);
        }
      }
    }

    // Check emails against existing Bolo users (smart resolution)
    const emailParticipants: Array<{ email: string; userId: string | null; name: string | null; autoApprove: boolean }> = [];
    for (const email of dto.participantEmails || []) {
      const normalizedEmail = email.toLowerCase().trim();

      // Skip if already added via handle
      if (handleUsers.some(hu => hu.email.toLowerCase() === normalizedEmail)) {
        continue;
      }

      // Skip if already added as email participant (dedup)
      if (emailParticipants.some(ep => ep.email.toLowerCase() === normalizedEmail)) {
        continue;
      }

      // Check if this email belongs to an existing Bolo user
      // Check: User.email, UserEmail table, AND UserIdentity table
      let existingUser = await this.prisma.user.findFirst({
        where: {
          OR: [
            { email: { equals: email, mode: 'insensitive' } },
            { emails: { some: { email: { equals: email, mode: 'insensitive' } } } },
          ],
        },
        select: { id: true, email: true, name: true, handle: true, autoApproveMeetings: true },
      });

      // If not found, check UserIdentity table for linked email identity
      if (!existingUser) {
        const identity = await (this.prisma as any).userIdentity.findFirst({
          where: {
            value: { equals: normalizedEmail, mode: 'insensitive' },
            identityType: { code: 'EMAIL' },
          },
          include: {
            user: {
              select: { id: true, email: true, name: true, handle: true, autoApproveMeetings: true },
            },
          },
        });
        if (identity?.user) {
          existingUser = identity.user;
          this.logger.log(`Email ${email} found via UserIdentity → user @${identity.user.handle}`);
        }
      }

      if (existingUser) {
        // Found a Bolo user - link them directly
        emailParticipants.push({
          email: existingUser.email,
          userId: existingUser.id,
          name: existingUser.name,
          autoApprove: existingUser.autoApproveMeetings,
        });
        this.logger.log(
          `Email ${email} resolved to Bolo user @${existingUser.handle} (${existingUser.id}), autoApprove: ${existingUser.autoApproveMeetings}`
        );
      } else {
        // Not a Bolo user - add as email-only participant (auto-approve since they're not on platform)
        emailParticipants.push({
          email,
          userId: null,
          name: null,
          autoApprove: true, // Non-Bolo users auto-approve (they'll respond via email link)
        });
      }
    }

    // Check phone numbers against existing Bolo users (resolve to @handle if verified)
    const phoneParticipants: Array<{ email: string; userId: string | null; name: string | null; autoApprove: boolean; phone: string }> = [];
    for (const phone of dto.participantPhones || []) {
      // Normalize phone number (remove spaces, ensure format consistency)
      const normalizedPhone = phone.replace(/[^\d+]/g, '');

      // Skip if this user was already added via handle or email
      const alreadyAdded = handleUsers.some(hu => hu.userId) ||
        emailParticipants.some(ep => ep.userId);

      // Check UserIdentity table for verified phone
      const phoneIdentity = await (this.prisma as any).userIdentity.findFirst({
        where: {
          value: normalizedPhone,
          identityType: { code: 'PHONE' },
        },
        include: {
          user: {
            select: { id: true, email: true, name: true, handle: true, autoApproveMeetings: true },
          },
        },
      });

      if (phoneIdentity?.user) {
        // Phone belongs to a Bolo user - check if already added
        const userAlreadyAdded = handleUsers.some(hu => hu.userId === phoneIdentity.user.id) ||
          emailParticipants.some(ep => ep.userId === phoneIdentity.user.id);

        if (!userAlreadyAdded) {
          phoneParticipants.push({
            email: phoneIdentity.user.email,
            userId: phoneIdentity.user.id,
            name: phoneIdentity.user.name,
            autoApprove: phoneIdentity.user.autoApproveMeetings,
            phone: normalizedPhone,
          });
          this.logger.log(
            `Phone ${phone} resolved to Bolo user @${phoneIdentity.user.handle} (${phoneIdentity.user.id})`
          );
        } else {
          this.logger.log(`Phone ${phone} user already added via handle or email, skipping`);
        }
      } else {
        // Phone not linked to Bolo user - add as phone-only participant
        // TODO: In future, send SMS invitation via Twilio
        phoneParticipants.push({
          email: '', // No email for phone-only
          userId: null,
          name: null,
          autoApprove: true,
          phone: normalizedPhone,
        });
        this.logger.log(`Phone ${phone} not found in Bolo - adding as external participant`);
      }
    }

    // Merge: handle users + email participants + phone participants
    const allParticipants = [
      ...handleUsers.map(u => ({ email: u.email, userId: u.userId, name: u.name, autoApprove: false, phone: null as string | null })),
      ...emailParticipants.map(p => ({ ...p, autoApprove: p.userId ? false : true, phone: null as string | null })),
      ...phoneParticipants.map(p => ({ ...p, autoApprove: p.userId ? false : true })),
    ];

    if (allParticipants.length === 0) {
      throw new NotFoundException('No valid participants found');
    }

    // Check if organizer is a trusted contact for each Bolo participant
    // Also collect per-contact bookable hours for slot finding
    // Use intersection of all participants' bookable hours (latest start, earliest end)
    const participantHoursWindows: { start: number; end: number }[] = [];

    for (const participant of allParticipants) {
      if (participant.userId) {
        const trustStatus = await this.contactsService.isOrganizerTrusted(
          participant.userId,
          organizer.id,
          organizer.handle,
        );
        if (trustStatus.isTrusted && trustStatus.autoApproveInvites) {
          participant.autoApprove = true;
          this.logger.log(`Organizer @${organizer.handle} is trusted by user ${participant.userId} - auto-approving`);
        } else {
          this.logger.log(`Organizer @${organizer.handle} is NOT trusted by user ${participant.userId} - requiring approval`);
        }

        // Get per-contact bookable hours
        const contactHours = await this.contactsService.getContactBookableHours(
          participant.userId,
          organizer.id,
          organizer.handle,
        );
        participantHoursWindows.push({ start: contactHours.hoursStart, end: contactHours.hoursEnd });
      }
    }

    // Resolve effective hours: intersection of all participant windows
    // Start with organizer's requested range, then narrow by each participant's allowed hours
    let resolvedHoursStart = dto.timeRangeStart ?? 9;
    let resolvedHoursEnd = dto.timeRangeEnd ?? 18;

    if (participantHoursWindows.length > 0) {
      // Find the widest window any contact allows (union), then intersect with organizer range
      const widestStart = Math.min(...participantHoursWindows.map(w => w.start));
      const widestEnd = Math.max(...participantHoursWindows.map(w => w.end));
      // Use the wider of organizer's range and participant custom hours
      resolvedHoursStart = Math.min(resolvedHoursStart, widestStart);
      resolvedHoursEnd = Math.max(resolvedHoursEnd, widestEnd);
    }

    this.logger.log(`Resolved bookable hours for meeting: ${resolvedHoursStart}-${resolvedHoursEnd}`);

    // Calculate invitation expiration for external users (default 48 hours)
    const responseDeadlineHours = 48;
    const invitationExpiration = new Date(Date.now() + responseDeadlineHours * 60 * 60 * 1000);

    // Create meeting request
    const meeting = await this.prisma.meetingRequest.create({
      data: {
        organizerId,
        title: dto.title,
        description: dto.description,
        duration: dto.duration,
        dateRangeStart: dto.dateRangeStart,
        dateRangeEnd: dto.dateRangeEnd,
        timezone: dto.timezone,
        customHoursStart: resolvedHoursStart,
        customHoursEnd: resolvedHoursEnd,
        recordingPolicy: dto.recordingPolicy || 'ALLOWED',
        responseDeadlineHours,
        preferredConnectionId: dto.preferredConnectionId || organizerCalendar.id,
        createVideoConference: dto.createVideoConference ?? true,
        workflow: dto.workflow || 'AUTO',
        status: 'PENDING',
        participants: {
          create: [
            // Add organizer as participant with ORGANIZER role
            {
              email: organizer.email,
              userId: organizer.id,
              name: organizer.name,
              role: 'ORGANIZER',
              responseStatus: 'RESPONDED',
              invitationStatus: 'APPROVED',
            },
            // Add all invitees
            ...allParticipants.map((p) => ({
              email: p.email,
              userId: p.userId,
              name: p.name,
              role: 'INVITEE',
              responseStatus: 'PENDING',
              invitationStatus: p.autoApprove ? 'APPROVED' : 'PENDING_APPROVAL',
              // External users (no userId) get an expiration deadline
              invitationExpiresAt: p.userId ? null : invitationExpiration,
            })),
          ],
        },
      },
      include: {
        participants: true,
        organizer: {
          select: { id: true, handle: true, name: true, email: true },
        },
      },
    });

    // For Bolo users (already linked via userId), check calendar connections
    // Track which participants need email invites (no calendar)
    const participantsNeedingEmail: string[] = [];
    let allBoloUsersWithCalendars = true; // Track if this is a Bolo-to-Bolo meeting

    for (const participant of meeting.participants) {
      if (participant.userId) {
        // Already linked - check if they have a connected calendar
        const userWithCalendar = await this.prisma.user.findUnique({
          where: { id: participant.userId },
          include: { calendarConnections: { where: { isEnabled: true } } },
        });

        if (userWithCalendar) {
          const hasCalendar = userWithCalendar.calendarConnections.length > 0;

          // Update participant with calendar info
          await this.prisma.participant.update({
            where: { id: participant.id },
            data: {
              useConnectedCalendar: hasCalendar,
              // Bolo users with calendars are auto-responded
              responseStatus: hasCalendar ? 'RESPONDED' : 'PENDING',
              respondedAt: hasCalendar ? new Date() : null,
            },
          });

          this.logger.log(
            `Bolo user ${participant.email} has calendar: ${hasCalendar}`
          );

          // Bolo users WITHOUT calendars need email invite to submit manual availability
          if (!hasCalendar) {
            participantsNeedingEmail.push(participant.id);
            allBoloUsersWithCalendars = false;
          }
        }
      } else {
        // Non-Bolo users always need email
        participantsNeedingEmail.push(participant.id);
        allBoloUsersWithCalendars = false;
      }
    }

    // For Bolo-to-Bolo meetings (all participants have calendars), skip invitation emails
    // The system will auto-schedule using their calendar availability
    if (allBoloUsersWithCalendars) {
      this.logger.log(
        `Bolo-to-Bolo meeting ${meeting.id}: all participants have calendars, skipping invitation emails`
      );
    }

    // Send invitation emails to participants who need them (non-Bolo OR Bolo without calendar)
    // Skip entirely for Bolo-to-Bolo meetings where all participants have calendars
    if (!allBoloUsersWithCalendars) {
      for (const participant of meeting.participants) {
        if (!participantsNeedingEmail.includes(participant.id)) {
          this.logger.log(
            `Skipping email for ${participant.email} - has connected calendar`
          );
          continue;
        }

        if (participant.role === 'ORGANIZER') {
          continue; // Don't send email to organizer
        }
        // Create invitation token for email link
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        const invitationToken = await this.prisma.invitationToken.create({
          data: {
            participantId: participant.id,
            expiresAt,
          },
        });

        // Format date range for email
        const dateRange = `${dto.dateRangeStart.toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        })} - ${dto.dateRangeEnd.toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        })}`;

        // Send email
        const respondUrl = `${this.appUrl}/invite/${invitationToken.token}`;
        const emailResult = await this.emailService.sendMeetingInvite(participant.email, {
          organizerName: organizer.name || organizer.handle,
          organizerHandle: organizer.handle,
          meetingTitle: dto.title,
          proposedTime: dateRange,
          inviteToken: invitationToken.token,
          respondUrl,
        });

        // Update token with email status
        await this.prisma.invitationToken.update({
          where: { id: invitationToken.id },
          data: {
            emailSentAt: emailResult.success ? new Date() : null,
            emailStatus: emailResult.success ? 'SENT' : 'FAILED',
            emailMessageId: emailResult.messageId ?? null,
            emailError: emailResult.error ?? null,
          },
        });

        this.logger.log(
          `Invitation email ${emailResult.success ? 'sent' : 'failed'} to ${participant.email} for meeting ${meeting.id}${emailResult.error ? `: ${emailResult.error}` : ''}`
        );
      }
    }

    // Try to auto-schedule only for AUTO workflow meetings
    // For MANUAL workflow, organizer will review available slots and pick manually
    if ((dto.workflow || 'AUTO') === 'AUTO') {
      await this.tryAutoSchedule(meeting.id);
    } else {
      this.logger.log(`Meeting ${meeting.id} using MANUAL workflow - skipping auto-schedule`);
    }

    // Get all invitation tokens to return invite links
    const participantIds = meeting.participants.map((p) => p.id);
    const inviteTokens = await this.prisma.invitationToken.findMany({
      where: {
        participantId: { in: participantIds },
      },
    });

    // Map tokens to participants
    const tokenMap = new Map(inviteTokens.map((t) => [t.participantId, t]));

    // Return meeting with invite links
    return {
      ...meeting,
      inviteLinks: meeting.participants.map((p) => {
        const token = tokenMap.get(p.id);
        return {
          email: p.email,
          name: p.name,
          inviteUrl: token ? `${this.appUrl}/invite/${token.token}` : null,
          emailSent: token?.emailStatus === 'SENT',
        };
      }).filter((link) => link.inviteUrl),
    };
  }

  /**
   * Try to auto-schedule a meeting when all participants have responded.
   * Called after availability is submitted or calendar is connected.
   */
  async tryAutoSchedule(meetingId: string): Promise<boolean> {
    const meeting = await this.prisma.meetingRequest.findUnique({
      where: { id: meetingId },
      include: {
        participants: {
          include: {
            availabilitySlots: true,
            user: {
              include: {
                calendarConnections: {
                  where: { isEnabled: true },
                  include: {
                    calendars: { where: { isSelected: true } },
                  },
                },
              },
            },
          },
        },
        organizer: {
          select: { id: true, handle: true, name: true, email: true },
        },
      },
    });

    if (!meeting || meeting.status !== 'PENDING') {
      this.logger.log(`Meeting ${meetingId} not pending, skipping auto-schedule`);
      return false;
    }

    // Check if all participants have resolved (responded, declined, or expired)
    const allResolved = meeting.participants.every(
      p => p.responseStatus === 'RESPONDED' || p.responseStatus === 'DECLINED' || p.responseStatus === 'EXPIRED'
    );

    if (!allResolved) {
      this.logger.log(`Meeting ${meetingId}: not all participants resolved yet`);
      return false;
    }

    // Get responded (non-declined, non-expired) participants
    const respondedParticipants = meeting.participants.filter(
      p => p.responseStatus === 'RESPONDED'
    );

    // Log expired participants
    const expiredCount = meeting.participants.filter(p => p.responseStatus === 'EXPIRED').length;
    if (expiredCount > 0) {
      this.logger.log(`Meeting ${meetingId}: ${expiredCount} participant(s) expired - proceeding without them`);
    }

    // Check if at least one non-organizer participant responded (not declined/expired)
    const nonOrganizerRespondedCount = respondedParticipants.filter(
      p => p.role !== 'ORGANIZER'
    ).length;

    if (nonOrganizerRespondedCount === 0) {
      this.logger.log(`Meeting ${meetingId}: all non-organizer participants declined - cannot schedule`);
      return false;
    }

    // Find the best available slot
    const bestSlot = await this.findBestSlot(meeting, respondedParticipants);

    if (!bestSlot) {
      this.logger.log(`Meeting ${meetingId}: no common available slot found`);

      // Notify the organizer that no slots were found
      const organizer = meeting.organizer;
      if (organizer?.email) {
        await this.emailService.sendNoAvailabilityNotification(organizer.email, {
          meetingTitle: meeting.title,
          meetingId: meeting.id,
          dateRangeStart: meeting.dateRangeStart.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          }),
          dateRangeEnd: meeting.dateRangeEnd.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          }),
          timeRangeStart: meeting.customHoursStart ?? 9,
          timeRangeEnd: meeting.customHoursEnd ?? 18,
          participantCount: respondedParticipants.length,
        });
        this.logger.log(`Sent no-availability notification to organizer ${organizer.email}`);
      }

      return false;
    }

    // Confirm the meeting with the best slot
    const endTime = new Date(bestSlot.startTime.getTime() + meeting.duration * 60000);

    // Try to create calendar event on organizer's Google Calendar
    let meetingLink: string | null = null;

    // Use preferred connection if set, otherwise find any enabled connection
    const organizerConnection = meeting.preferredConnectionId
      ? await this.prisma.calendarConnection.findFirst({
          where: {
            id: meeting.preferredConnectionId,
            userId: meeting.organizerId,
            isEnabled: true,
          },
          include: {
            calendars: { where: { isPrimary: true } },
          },
        })
      : await this.prisma.calendarConnection.findFirst({
          where: {
            userId: meeting.organizerId,
            isEnabled: true,
          },
          include: {
            calendars: { where: { isPrimary: true } },
          },
        });

    if (organizerConnection) {
      try {
        let accessToken = organizerConnection.accessToken;
        const provider = organizerConnection.provider;

        // Refresh token if expired
        if (organizerConnection.expiresAt && organizerConnection.expiresAt < new Date()) {
          if (organizerConnection.refreshToken) {
            this.logger.log(`Refreshing expired ${provider} token for organizer ${meeting.organizerId}`);
            try {
              const newTokens = provider === 'GOOGLE'
                ? await this.googleCalendarProvider.refreshToken(organizerConnection.refreshToken)
                : await this.microsoftCalendarProvider.refreshToken(organizerConnection.refreshToken);
              accessToken = newTokens.accessToken;

              // Update stored tokens
              await this.prisma.calendarConnection.update({
                where: { id: organizerConnection.id },
                data: {
                  accessToken: newTokens.accessToken,
                  expiresAt: newTokens.expiresAt,
                },
              });
            } catch (tokenErr: any) {
              // Handle token failure gracefully
              await this.handleTokenFailure(
                organizerConnection.id,
                meeting.organizerId,
                tokenErr.message || 'Token refresh failed'
              );
              throw new Error('Organizer calendar connection expired - please reconnect');
            }
          }
        }

        // Get attendee emails (all non-declined participants + organizer)
        const attendeeEmails = respondedParticipants.map(p => p.email);

        // Find primary calendar or use default
        const calendarId = organizerConnection.calendars[0]?.externalId || 'primary';

        // Create the event with video conferencing based on provider
        const createVideoConference = meeting.createVideoConference ?? true;

        if (provider === 'GOOGLE') {
          const event = await this.googleCalendarProvider.createEvent(
            accessToken!,
            calendarId,
            {
              title: meeting.title,
              description: meeting.description || undefined,
              startTime: bestSlot.startTime,
              endTime,
              attendees: attendeeEmails,
              boloMeetingId: meetingId,
              createVideoConference,
            }
          );
          // Use Google Meet link if created, otherwise calendar link
          meetingLink = event.meetLink || event.htmlLink;
          this.logger.log(`Created Google Calendar event ${event.id} for meeting ${meetingId}${event.meetLink ? ' with Google Meet' : ''}`);
        } else if (provider === 'MICROSOFT') {
          const event = await this.microsoftCalendarProvider.createEvent(
            accessToken!,
            calendarId,
            {
              title: meeting.title,
              description: meeting.description || undefined,
              startTime: bestSlot.startTime,
              endTime,
              attendees: attendeeEmails,
              boloMeetingId: meetingId,
              createVideoConference,
            }
          );
          // Use Teams link if created, otherwise Outlook link
          meetingLink = event.meetLink || event.htmlLink;
          this.logger.log(`Created Microsoft Calendar event ${event.id} for meeting ${meetingId}${event.meetLink ? ' with Teams' : ''}`);
        }
      } catch (err) {
        this.logger.error(`Failed to create calendar event: ${err}`);
        // Continue without calendar event - meeting is still confirmed
      }
    } else {
      this.logger.log(`Organizer ${meeting.organizerId} has no calendar connected`);
    }

    await this.prisma.meetingRequest.update({
      where: { id: meetingId },
      data: {
        status: 'CONFIRMED',
        confirmedStartTime: bestSlot.startTime,
        confirmedEndTime: endTime,
        meetingLink,
      },
    });

    this.logger.log(
      `Meeting ${meetingId} auto-scheduled for ${bestSlot.startTime.toISOString()}`
    );

    // Send confirmation emails to all participants
    await this.sendConfirmationEmails(meeting, bestSlot.startTime, endTime, meetingLink);

    return true;
  }

  /**
   * Find the best available slot from participants' availability.
   * For manual availability, picks the earliest slot that fits the duration.
   * For connected calendars, queries Google Calendar free/busy API.
   */
  private async findBestSlot(
    meeting: any,
    participants: any[],
  ): Promise<{ startTime: Date; endTime: Date } | null> {
    // Separate participants by their availability source
    const manualParticipants = participants.filter(
      p => p.availabilitySlots && p.availabilitySlots.length > 0
    );
    const calendarParticipants = participants.filter(
      p => !p.availabilitySlots?.length && p.userId && p.useConnectedCalendar
    );

    this.logger.log(
      `Finding slot: ${manualParticipants.length} manual, ${calendarParticipants.length} calendar participants`
    );

    // If we have manual slots, find candidate slots from them
    if (manualParticipants.length > 0) {
      return this.findBestSlotHybrid(meeting, manualParticipants, calendarParticipants);
    }

    // All calendar-based scheduling
    return this.findBestSlotFromCalendars(meeting, participants);
  }

  /**
   * Hybrid slot finding: use manual slots as candidates, verify against calendar busy times
   */
  private async findBestSlotHybrid(
    meeting: any,
    manualParticipants: any[],
    calendarParticipants: any[],
  ): Promise<{ startTime: Date; endTime: Date } | null> {
    // Get all manual slots
    const allManualSlots: Array<{ startTime: Date; endTime: Date; participantId: string }> = [];
    for (const participant of manualParticipants) {
      for (const slot of participant.availabilitySlots || []) {
        allManualSlots.push({
          startTime: new Date(slot.startTime),
          endTime: new Date(slot.endTime),
          participantId: participant.id,
        });
      }
    }

    if (allManualSlots.length === 0) {
      return null;
    }

    allManualSlots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    // Get busy times for calendar participants
    const calendarBusyTimes: Array<{ start: Date; end: Date }> = [];
    for (const p of calendarParticipants) {
      const connection = await this.prisma.calendarConnection.findFirst({
        where: { userId: p.userId, provider: 'GOOGLE', isEnabled: true },
        include: { calendars: { where: { isPrimary: true } } },
      });

      if (!connection?.accessToken) continue;

      let accessToken = connection.accessToken;
      if (connection.expiresAt && connection.expiresAt < new Date() && connection.refreshToken) {
        try {
          const newTokens = await this.googleCalendarProvider.refreshToken(connection.refreshToken);
          accessToken = newTokens.accessToken;
          await this.prisma.calendarConnection.update({
            where: { id: connection.id },
            data: { accessToken: newTokens.accessToken, expiresAt: newTokens.expiresAt },
          });
        } catch (tokenErr: any) {
          // Mark connection as broken and notify user
          if (p.userId) {
            await this.handleTokenFailure(connection.id, p.userId, tokenErr.message || 'Token refresh failed');
          }
          continue;
        }
      }

      const calendarId = connection.calendars[0]?.externalId || 'primary';
      try {
        const busyMap = await this.googleCalendarProvider.getFreeBusy(
          accessToken,
          [calendarId],
          meeting.dateRangeStart,
          meeting.dateRangeEnd,
        );
        const busyTimes = busyMap.get(calendarId) || [];
        calendarBusyTimes.push(...busyTimes);
      } catch (err) {
        this.logger.error(`Failed to get busy times for ${p.userId}: ${err}`);
      }
    }

    // Merge busy times
    const mergedBusy = this.mergeBusyTimes(calendarBusyTimes);

    // Find a slot that works for all manual participants AND doesn't conflict with calendar busy times
    for (const slot of allManualSlots) {
      const slotDuration = (slot.endTime.getTime() - slot.startTime.getTime()) / 60000;
      if (slotDuration < meeting.duration) continue;

      const candidateStart = slot.startTime;
      const candidateEnd = new Date(candidateStart.getTime() + meeting.duration * 60000);

      // Check all manual participants have this slot
      const allManualHaveSlot = manualParticipants.every(p => {
        if (p.id === slot.participantId) return true;
        return (p.availabilitySlots || []).some((s: any) => {
          const sStart = new Date(s.startTime).getTime();
          const sEnd = new Date(s.endTime).getTime();
          return sStart <= candidateStart.getTime() && sEnd >= candidateEnd.getTime();
        });
      });

      if (!allManualHaveSlot) continue;

      // Check no conflict with calendar busy times
      const hasCalendarConflict = mergedBusy.some(
        busy => candidateStart < busy.end && candidateEnd > busy.start
      );

      if (!hasCalendarConflict) {
        this.logger.log(`Found hybrid slot: ${candidateStart.toISOString()}`);
        return { startTime: candidateStart, endTime: candidateEnd };
      }
    }

    this.logger.log('No hybrid slot found');
    return null;
  }
  /**
   * Find best slot by querying Google Calendar free/busy for all connected calendars.
   * Includes organizer + all participants with connected calendars.
   */
  private async findBestSlotFromCalendars(
    meeting: any,
    participants: any[],
  ): Promise<{ startTime: Date; endTime: Date } | null> {
    this.logger.log(`Finding slot from calendars for meeting ${meeting.id}`);

    // Collect all users we need to check (organizer + participants)
    const usersToCheck: Array<{ userId: string; email: string }> = [];

    // Add organizer
    usersToCheck.push({ userId: meeting.organizerId, email: meeting.organizer.email });

    // Add participants with connected calendars
    for (const p of participants) {
      if (p.userId && p.useConnectedCalendar) {
        usersToCheck.push({ userId: p.userId, email: p.email });
      }
    }

    this.logger.log(`Checking calendars for ${usersToCheck.length} users`);

    // Get calendar connections and tokens for each user
    const calendarData: Array<{
      userId: string;
      accessToken: string;
      calendarId: string;
    }> = [];

    for (const user of usersToCheck) {
      const connection = await this.prisma.calendarConnection.findFirst({
        where: {
          userId: user.userId,
          provider: 'GOOGLE',
          isEnabled: true,
        },
        include: {
          calendars: { where: { isPrimary: true } },
        },
      });

      if (!connection) {
        this.logger.warn(`No calendar connection for user ${user.userId}`);
        continue;
      }

      let accessToken = connection.accessToken;

      // Refresh if expired
      if (connection.expiresAt && connection.expiresAt < new Date() && connection.refreshToken) {
        try {
          const newTokens = await this.googleCalendarProvider.refreshToken(connection.refreshToken);
          accessToken = newTokens.accessToken;
          await this.prisma.calendarConnection.update({
            where: { id: connection.id },
            data: { accessToken: newTokens.accessToken, expiresAt: newTokens.expiresAt },
          });
        } catch (err: any) {
          this.logger.error(`Failed to refresh token for ${user.userId}: ${err}`);
          // Mark connection as broken and notify user
          await this.handleTokenFailure(connection.id, user.userId!, err.message || 'Token refresh failed');
          continue;
        }
      }

      const calendarId = connection.calendars[0]?.externalId || 'primary';
      calendarData.push({ userId: user.userId, accessToken: accessToken!, calendarId });
    }

    if (calendarData.length === 0) {
      this.logger.warn('No valid calendar connections found');
      return null;
    }

    // Query free/busy for each user's calendar
    const allBusyTimes: Array<{ start: Date; end: Date }> = [];

    for (const cal of calendarData) {
      try {
        const busyMap = await this.googleCalendarProvider.getFreeBusy(
          cal.accessToken,
          [cal.calendarId],
          meeting.dateRangeStart,
          meeting.dateRangeEnd,
        );
        const busyTimes = busyMap.get(cal.calendarId) || [];
        allBusyTimes.push(...busyTimes);
        this.logger.log(`User ${cal.userId} has ${busyTimes.length} busy blocks`);
      } catch (err) {
        this.logger.error(`Failed to get free/busy for ${cal.userId}: ${err}`);
      }
    }

    // Merge overlapping busy times
    const mergedBusy = this.mergeBusyTimes(allBusyTimes);
    this.logger.log(`Total merged busy blocks: ${mergedBusy.length}`);

    // Find available slots during specified hours, widened by any approved override requests
    let workingHourStart = meeting.customHoursStart ?? 9;
    let workingHourEnd = meeting.customHoursEnd ?? 18;

    // Check for approved override requests that widen the hours
    const approvedOverrides = await this.prisma.hoursOverrideRequest.findMany({
      where: { meetingRequestId: meeting.id, status: 'APPROVED' },
    });
    for (const override of approvedOverrides) {
      workingHourStart = Math.min(workingHourStart, override.requestedStart);
      workingHourEnd = Math.max(workingHourEnd, override.requestedEnd);
    }
    const slotInterval = 30; // Check every 30 minutes

    // Use Luxon for timezone-aware date handling
    const meetingTimezone = meeting.timezone || 'America/New_York';
    let cursor = DateTime.fromJSDate(meeting.dateRangeStart, { zone: meetingTimezone });
    const endDate = DateTime.fromJSDate(meeting.dateRangeEnd, { zone: meetingTimezone });
    const now = DateTime.now().setZone(meetingTimezone);

    this.logger.log(`Finding slots in timezone: ${meetingTimezone}, from ${cursor.toISO()} to ${endDate.toISO()}`);

    while (cursor <= endDate) {
      // Skip weekends (Luxon weekday: 1=Mon, 7=Sun)
      const dayOfWeek = cursor.weekday;
      if (dayOfWeek === 6 || dayOfWeek === 7) {
        cursor = cursor.plus({ days: 1 }).set({ hour: workingHourStart, minute: 0, second: 0, millisecond: 0 });
        continue;
      }

      // Check slots during working hours
      for (let hour = workingHourStart; hour < workingHourEnd; hour++) {
        for (let minute = 0; minute < 60; minute += slotInterval) {
          const slotStart = cursor.set({ hour, minute, second: 0, millisecond: 0 });
          const slotEnd = slotStart.plus({ minutes: meeting.duration });

          // Don't go past working hours
          if (slotEnd.hour > workingHourEnd ||
              (slotEnd.hour === workingHourEnd && slotEnd.minute > 0)) {
            continue;
          }

          // Don't check slots in the past
          if (slotStart < now) {
            continue;
          }

          // Convert to JS Date for busy time comparison
          const slotStartDate = slotStart.toJSDate();
          const slotEndDate = slotEnd.toJSDate();

          // Check if slot conflicts with any busy time
          const hasConflict = mergedBusy.some(busy =>
            slotStartDate < busy.end && slotEndDate > busy.start
          );

          if (!hasConflict) {
            this.logger.log(`Found available slot: ${slotStart.toISO()} (${meetingTimezone})`);
            return { startTime: slotStartDate, endTime: slotEndDate };
          }
        }
      }

      cursor = cursor.plus({ days: 1 }).set({ hour: workingHourStart, minute: 0, second: 0, millisecond: 0 });
    }

    this.logger.log('No available slot found in date range');
    return null;
  }

  /**
   * Merge overlapping busy time blocks into a consolidated list
   */
  private mergeBusyTimes(busyTimes: Array<{ start: Date; end: Date }>): Array<{ start: Date; end: Date }> {
    if (busyTimes.length === 0) return [];

    // Sort by start time
    const sorted = [...busyTimes].sort((a, b) => a.start.getTime() - b.start.getTime());
    const merged: Array<{ start: Date; end: Date }> = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      const last = merged[merged.length - 1];

      if (current.start <= last.end) {
        // Overlapping - extend the last block
        last.end = new Date(Math.max(last.end.getTime(), current.end.getTime()));
      } else {
        merged.push(current);
      }
    }

    return merged;
  }

  /**
   * Send confirmation emails to all participants.
   * For Bolo-to-Bolo meetings (all participants have connected calendars),
   * confirmation emails are skipped since the calendar event serves as confirmation.
   */
  private async sendConfirmationEmails(
    meeting: any,
    startTime: Date,
    endTime: Date,
    meetingLink?: string | null,
  ) {
    // Check if this is a Bolo-to-Bolo meeting (all participants have userId and useConnectedCalendar)
    const isBoloToBolo = meeting.participants.every(
      (p: any) => p.userId && p.useConnectedCalendar
    );

    if (isBoloToBolo) {
      this.logger.log(
        `Bolo-to-Bolo meeting ${meeting.id}: skipping confirmation emails (calendar events serve as confirmation)`
      );
      return;
    }

    const formattedTime = startTime.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });

    for (const participant of meeting.participants) {
      if (participant.responseStatus === 'DECLINED') continue;

      try {
        await this.emailService.sendMeetingConfirmation(participant.email, {
          organizerName: meeting.organizer.name || meeting.organizer.handle,
          meetingTitle: meeting.title,
          confirmedTime: formattedTime,
          duration: meeting.duration,
          meetingLink: meetingLink || meeting.meetingLink,
        });
        this.logger.log(`Confirmation email sent to ${participant.email}`);
      } catch (err) {
        this.logger.error(`Failed to send confirmation to ${participant.email}: ${err}`);
      }
    }
  }

  async bookMeeting(organizerId: string, dto: BookMeetingDto) {
    // Get organizer info including working hours
    const organizer = await this.prisma.user.findUnique({
      where: { id: organizerId },
      select: {
        id: true,
        handle: true,
        name: true,
        email: true,
        workingHoursStart: true,
        workingHoursEnd: true,
        workingDays: true,
      },
    });

    if (!organizer) {
      throw new NotFoundException('Organizer not found');
    }

    // Check if organizer has a connected calendar - required for booking
    const organizerCalendar = await this.prisma.calendarConnection.findFirst({
      where: {
        userId: organizerId,
        isEnabled: true,
      },
    });

    if (!organizerCalendar) {
      throw new BadRequestException(
        'You must connect a calendar before booking meetings. Go to Settings > Connections to connect your Google or Microsoft calendar.'
      );
    }

    // Validate meeting time is within working hours (9am-6pm by default)
    const startHour = dto.startTime.getHours();
    const endHour = dto.endTime.getHours();
    const dayOfWeek = dto.startTime.getDay(); // 0=Sunday, 1=Monday, etc.

    const workingStart = organizer.workingHoursStart ?? 9;
    const workingEnd = organizer.workingHoursEnd ?? 18;
    const workingDays = organizer.workingDays ?? [1, 2, 3, 4, 5]; // Mon-Fri

    if (startHour < workingStart || endHour > workingEnd || !workingDays.includes(dayOfWeek)) {
      this.logger.warn(
        `Meeting time ${dto.startTime.toISOString()} is outside working hours ` +
        `(${workingStart}:00-${workingEnd}:00, days: ${workingDays.join(',')})`
      );
      throw new ForbiddenException(
        `Meeting must be scheduled within working hours (${workingStart}:00-${workingEnd}:00) on working days`
      );
    }

    this.logger.log(`Booking meeting at ${dto.startTime.toISOString()} - within working hours`);

    // Look up users by handle and validate each one exists
    const invalidHandles: string[] = [];
    const validBoloUsers: Array<{ id: string; email: string; handle: string; name: string | null; autoApproveMeetings: boolean }> = [];

    for (const handle of dto.participantHandles) {
      const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle;

      // Check User.handle directly
      let user = await this.prisma.user.findFirst({
        where: { handle: { equals: cleanHandle, mode: 'insensitive' } },
        select: { id: true, email: true, handle: true, name: true, autoApproveMeetings: true },
      });

      // If not found, check UserIdentity for BOLO_HANDLE
      if (!user) {
        const identity = await (this.prisma as any).userIdentity.findFirst({
          where: {
            value: { equals: cleanHandle.toLowerCase(), mode: 'insensitive' },
            identityType: { code: 'BOLO_HANDLE' },
          },
          include: {
            user: {
              select: { id: true, email: true, handle: true, name: true, autoApproveMeetings: true },
            },
          },
        });
        if (identity?.user) {
          user = identity.user;
        }
      }

      if (user) {
        validBoloUsers.push(user);
        this.logger.log(`Handle @${cleanHandle} resolved to user @${user.handle}`);
      } else {
        invalidHandles.push(handle);
        this.logger.warn(`Handle @${cleanHandle} not found`);
      }
    }

    // Reject if any handles are invalid
    if (invalidHandles.length > 0) {
      throw new NotFoundException(
        `Invalid handle(s): ${invalidHandles.join(', ')}. Please check the handles and try again.`
      );
    }

    const nonBoloEmails = dto.participantEmails || [];

    // At least one participant required
    if (validBoloUsers.length === 0 && nonBoloEmails.length === 0) {
      throw new NotFoundException('No valid participants found');
    }

    // Check if organizer is trusted by each Bolo user (for auto-approve)
    const autoApproveMap = new Map<string, boolean>();
    for (const user of validBoloUsers) {
      if (user) {
        const trustStatus = await this.contactsService.isOrganizerTrusted(
          user.id,
          organizer.id,
          organizer.handle,
        );
        const shouldAutoApprove = trustStatus.isTrusted && trustStatus.autoApproveInvites;
        autoApproveMap.set(user.id, shouldAutoApprove);
        this.logger.log(
          `Organizer @${organizer.handle} ${shouldAutoApprove ? 'IS' : 'is NOT'} auto-approved by @${user.handle}`
        );
      }
    }

    // Calculate duration
    const duration = Math.round(
      (dto.endTime.getTime() - dto.startTime.getTime()) / 60000
    );

    // Determine initial status - ALWAYS PENDING unless ALL participants have explicitly auto-approved
    // Never auto-confirm if:
    // 1. There are non-Bolo users (they need to respond)
    // 2. There are Bolo users who haven't trusted the organizer
    // 3. There are no invitees at all (shouldn't happen, but safety check)
    const hasNonBoloUsers = nonBoloEmails.length > 0;
    const hasBoloUsers = validBoloUsers.length > 0;
    const allBoloUsersAutoApproved = hasBoloUsers && validBoloUsers.every(u => u && autoApproveMap.get(u.id));
    const canConfirmImmediately = hasBoloUsers && !hasNonBoloUsers && allBoloUsersAutoApproved;
    const initialStatus = canConfirmImmediately ? 'CONFIRMED' : 'PENDING';

    this.logger.log(
      `Meeting status decision: hasNonBoloUsers=${hasNonBoloUsers}, hasBoloUsers=${hasBoloUsers}, ` +
      `allBoloUsersAutoApproved=${allBoloUsersAutoApproved}, canConfirmImmediately=${canConfirmImmediately}, ` +
      `initialStatus=${initialStatus}`
    );

    // Create meeting with participants
    const meeting = await this.prisma.meetingRequest.create({
      data: {
        organizerId,
        title: dto.title,
        description: dto.description,
        duration,
        dateRangeStart: dto.startTime,
        dateRangeEnd: dto.endTime,
        timezone: dto.timezone,
        status: initialStatus,
        confirmedStartTime: canConfirmImmediately ? dto.startTime : null,
        confirmedEndTime: canConfirmImmediately ? dto.endTime : null,
        meetingLink: dto.location,
        participants: {
          create: [
            // Add organizer as participant with ORGANIZER role
            {
              email: organizer.email,
              name: organizer.name,
              userId: organizer.id,
              role: 'ORGANIZER',
              responseStatus: 'RESPONDED',
              invitationStatus: 'APPROVED',
              useConnectedCalendar: true,
            },
            // Bolo users (invitees) - only auto-approve if organizer is in their trusted contacts
            ...validBoloUsers.map((user) => ({
              email: user!.email,
              name: user!.name,
              userId: user!.id,
              role: 'INVITEE',
              responseStatus: 'PENDING',
              invitationStatus: autoApproveMap.get(user!.id) ? 'APPROVED' : 'PENDING_APPROVAL',
              useConnectedCalendar: true,
            })),
            // Non-Bolo users (email only) - auto-approve since they'll respond via email link
            ...nonBoloEmails.map((email) => ({
              email,
              name: null,
              userId: null,
              role: 'INVITEE',
              responseStatus: 'PENDING',
              invitationStatus: 'APPROVED',
              useConnectedCalendar: false,
            })),
          ],
        },
      },
      include: {
        participants: {
          include: {
            user: { select: { id: true, handle: true, name: true } },
          },
        },
        organizer: {
          select: { id: true, handle: true, name: true, email: true },
        },
      },
    });

    // Create invitation tokens and send emails to non-Bolo users
    const nonBoloParticipants = meeting.participants.filter(p => !p.userId);

    for (const participant of nonBoloParticipants) {
      // Create invitation token (expires in 7 days)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const invitationToken = await this.prisma.invitationToken.create({
        data: {
          participantId: participant.id,
          expiresAt,
        },
      });

      // Send invitation email
      const respondUrl = `${this.appUrl}/invite/${invitationToken.token}`;
      const proposedTime = dto.startTime.toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      });

      const emailResult = await this.emailService.sendMeetingInvite(participant.email, {
        organizerName: organizer.name || organizer.handle,
        organizerHandle: organizer.handle,
        meetingTitle: dto.title,
        proposedTime,
        inviteToken: invitationToken.token,
        respondUrl,
      });

      // Update token with email status
      await this.prisma.invitationToken.update({
        where: { id: invitationToken.id },
        data: {
          emailSentAt: emailResult.success ? new Date() : null,
          emailStatus: emailResult.success ? 'SENT' : 'FAILED',
          emailMessageId: emailResult.messageId ?? null,
          emailError: emailResult.error ?? null,
        },
      });

      this.logger.log(
        `Invitation email ${emailResult.success ? 'sent' : 'failed'} to ${participant.email} for meeting ${meeting.id}${emailResult.error ? `: ${emailResult.error}` : ''}`
      );
    }

    // If meeting is immediately confirmed (all Bolo users), create calendar events
    if (meeting.status === 'CONFIRMED' && meeting.confirmedStartTime && meeting.confirmedEndTime) {
      await this.createCalendarEventsForParticipants(
        {
          id: meeting.id,
          title: meeting.title,
          description: meeting.description,
          confirmedStartTime: meeting.confirmedStartTime,
          confirmedEndTime: meeting.confirmedEndTime,
          meetingLink: meeting.meetingLink,
          organizerId: organizer.id,
          organizerHandle: organizer.handle,
        },
        meeting.participants.map(p => ({
          id: p.id,
          email: p.email,
          userId: p.userId,
          invitationStatus: p.invitationStatus,
        })),
      );
    }

    return meeting;
  }

  async getMeeting(meetingId: string, userId?: string) {
    // Check and update any expired invitations first
    const expiredCount = await this.checkAndUpdateExpiredInvitations(meetingId);

    const meeting = await this.prisma.meetingRequest.findUnique({
      where: { id: meetingId },
      include: {
        participants: {
          include: {
            user: {
              select: { id: true, handle: true, name: true },
            },
            availabilitySlots: true,
            invitationToken: {
              select: {
                emailStatus: true,
                emailError: true,
                emailRetryCount: true,
                emailSentAt: true,
              },
            },
          },
        },
        organizer: {
          select: { id: true, handle: true, name: true, email: true },
        },
      },
    });

    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }

    // If any invitations just expired, try auto-scheduling without them
    if (expiredCount > 0 && meeting.status === 'PENDING') {
      this.logger.log(`${expiredCount} invitation(s) expired - attempting auto-schedule without them`);
      await this.tryAutoSchedule(meetingId);
      // Re-fetch to get updated status
      return this.prisma.meetingRequest.findUnique({
        where: { id: meetingId },
        include: {
          participants: {
            include: {
              user: {
                select: { id: true, handle: true, name: true },
              },
              availabilitySlots: true,
              invitationToken: {
                select: {
                  emailStatus: true,
                  emailError: true,
                  emailRetryCount: true,
                  emailSentAt: true,
                },
              },
            },
          },
          organizer: {
            select: { id: true, handle: true, name: true, email: true },
          },
        },
      });
    }

    return meeting;
  }

  /**
   * Get combined availability for all meeting participants.
   * Returns busy times per participant for communal calendar view.
   */
  async getMeetingAvailability(meetingId: string, userId: string) {
    const meeting = await this.prisma.meetingRequest.findUnique({
      where: { id: meetingId },
      include: {
        participants: {
          include: {
            user: {
              select: { id: true, handle: true, name: true, email: true },
            },
          },
        },
        organizer: {
          select: { id: true, handle: true, name: true, email: true },
        },
      },
    });

    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }

    // Only organizer or participants can view availability
    const isParticipant = meeting.participants.some(p => p.userId === userId);
    if (meeting.organizerId !== userId && !isParticipant) {
      throw new ForbiddenException('You do not have access to this meeting');
    }

    // Collect busy times for each participant with a connected calendar
    const participantAvailability: Array<{
      participantId: string;
      email: string;
      name: string | null;
      handle: string | null;
      busyTimes: Array<{ start: string; end: string }>;
      hasCalendar: boolean;
    }> = [];

    for (const participant of meeting.participants) {
      const busyTimes: Array<{ start: string; end: string }> = [];
      let hasCalendar = false;

      if (participant.userId) {
        // Find their calendar connection
        const connection = await this.prisma.calendarConnection.findFirst({
          where: {
            userId: participant.userId,
            isEnabled: true,
          },
          include: {
            calendars: { where: { isPrimary: true } },
          },
        });

        if (connection) {
          hasCalendar = true;
          try {
            let accessToken = connection.accessToken;

            // Refresh if expired
            if (connection.expiresAt && connection.expiresAt < new Date() && connection.refreshToken) {
              try {
                const newTokens = connection.provider === 'GOOGLE'
                  ? await this.googleCalendarProvider.refreshToken(connection.refreshToken)
                  : await this.microsoftCalendarProvider.refreshToken(connection.refreshToken);
                accessToken = newTokens.accessToken;
                await this.prisma.calendarConnection.update({
                  where: { id: connection.id },
                  data: { accessToken: newTokens.accessToken, expiresAt: newTokens.expiresAt },
                });
              } catch (tokenErr: any) {
                this.logger.error(`Token refresh failed for ${participant.email}: ${tokenErr.message}`);
              }
            }

            if (accessToken && connection.provider === 'GOOGLE') {
              const calendarId = connection.calendars[0]?.externalId || 'primary';
              const busyMap = await this.googleCalendarProvider.getFreeBusy(
                accessToken,
                [calendarId],
                meeting.dateRangeStart,
                meeting.dateRangeEnd,
              );
              const times = busyMap.get(calendarId) || [];
              busyTimes.push(...times.map(t => ({
                start: t.start.toISOString(),
                end: t.end.toISOString(),
              })));
            }
            // TODO: Add Microsoft free/busy support
          } catch (err) {
            this.logger.error(`Failed to get busy times for ${participant.email}: ${err}`);
          }
        }
      }

      participantAvailability.push({
        participantId: participant.id,
        email: participant.email,
        name: participant.name || participant.user?.name || null,
        handle: participant.user?.handle || null,
        busyTimes,
        hasCalendar,
      });
    }

    return {
      meetingId: meeting.id,
      title: meeting.title,
      duration: meeting.duration,
      dateRangeStart: meeting.dateRangeStart.toISOString(),
      dateRangeEnd: meeting.dateRangeEnd.toISOString(),
      timeRangeStart: meeting.customHoursStart ?? 9,
      timeRangeEnd: meeting.customHoursEnd ?? 18,
      timezone: meeting.timezone,
      workflow: meeting.workflow,
      participants: participantAvailability,
    };
  }

  async getMeetingByShareCode(shareCode: string) {
    const meeting = await this.prisma.meetingRequest.findUnique({
      where: { shareCode },
      include: {
        participants: {
          include: {
            user: {
              select: { id: true, handle: true, name: true },
            },
          },
        },
        organizer: {
          select: { id: true, handle: true, name: true },
        },
      },
    });

    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }

    return meeting;
  }

  async listUserMeetings(userId: string, role: 'organizer' | 'participant' | 'all' = 'all') {
    const where: any = {};

    if (role === 'organizer') {
      where.organizerId = userId;
    } else if (role === 'participant') {
      // Exclude meetings the participant has hidden
      where.participants = { some: { userId, isHidden: false } };
    } else {
      where.OR = [
        { organizerId: userId },
        // Exclude meetings the participant has hidden (but show organizer's meetings)
        { participants: { some: { userId, isHidden: false } } },
      ];
    }

    // First check for expired invitations on all pending meetings
    const pendingMeetings = await this.prisma.meetingRequest.findMany({
      where: { ...where, status: 'PENDING' },
      select: { id: true },
    });

    for (const m of pendingMeetings) {
      await this.checkAndUpdateExpiredInvitations(m.id);
    }

    return this.prisma.meetingRequest.findMany({
      where,
      include: {
        participants: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            responseStatus: true,
            invitationStatus: true,
            invitationExpiresAt: true,
            createdAt: true,
            user: {
              select: { handle: true },
            },
            invitationToken: {
              select: {
                emailStatus: true,
                emailError: true,
                emailRetryCount: true,
              },
            },
          },
        },
        organizer: {
          select: { id: true, handle: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async confirmMeeting(
    meetingId: string,
    userId: string,
    startTime: Date,
    endTime: Date,
    meetingLink?: string,
  ) {
    // Clean up expired invitations before confirming
    await this.checkAndUpdateExpiredInvitations(meetingId);

    const meeting = await this.prisma.meetingRequest.findUnique({
      where: { id: meetingId },
      include: {
        participants: {
          select: {
            id: true,
            email: true,
            userId: true,
            invitationStatus: true,
            responseStatus: true,
            useConnectedCalendar: true,
          },
        },
        organizer: {
          select: { id: true, handle: true, name: true },
        },
      },
    });

    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }

    if (meeting.organizerId !== userId) {
      throw new ForbiddenException('Only the organizer can confirm the meeting');
    }

    const updatedMeeting = await this.prisma.meetingRequest.update({
      where: { id: meetingId },
      data: {
        status: 'CONFIRMED',
        confirmedStartTime: startTime,
        confirmedEndTime: endTime,
        meetingLink,
      },
    });

    // Create calendar events for all participants with connected calendars
    await this.createCalendarEventsForParticipants(
      {
        id: meeting.id,
        title: meeting.title,
        description: meeting.description,
        confirmedStartTime: startTime,
        confirmedEndTime: endTime,
        meetingLink: meetingLink || null,
        organizerId: meeting.organizer.id,
        organizerHandle: meeting.organizer.handle,
      },
      meeting.participants,
    );

    return updatedMeeting;
  }

  async cancelMeeting(meetingId: string, userId: string) {
    const meeting = await this.prisma.meetingRequest.findUnique({
      where: { id: meetingId },
      include: {
        participants: {
          where: { userId: { not: null } },
          select: { userId: true },
        },
      },
    });

    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }

    if (meeting.organizerId !== userId) {
      throw new ForbiddenException('Only the organizer can cancel the meeting');
    }

    // Delete calendar events for all participants with connected calendars
    if (meeting.status === 'CONFIRMED' && meeting.confirmedStartTime && meeting.confirmedEndTime) {
      await this.deleteCalendarEventsForMeeting(meetingId, meeting);
    }

    return this.prisma.meetingRequest.update({
      where: { id: meetingId },
      data: { status: 'CANCELLED' },
    });
  }

  /**
   * Delete calendar events associated with a Bolo meeting from all participants' calendars.
   * Finds events by boloMeetingId in extended properties (Google) or description (Microsoft).
   */
  private async deleteCalendarEventsForMeeting(
    meetingId: string,
    meeting: { confirmedStartTime: Date | null; confirmedEndTime: Date | null },
  ) {
    if (!meeting.confirmedStartTime || !meeting.confirmedEndTime) return;

    // Find all calendar connections for participants in this meeting
    const participants = await this.prisma.participant.findMany({
      where: { meetingRequestId: meetingId, userId: { not: null } },
      select: { userId: true },
    });

    const userIds = participants.map(p => p.userId!);
    const connections = await this.prisma.calendarConnection.findMany({
      where: {
        userId: { in: userIds },
        isEnabled: true,
      },
      include: {
        calendars: { where: { isSelected: true }, take: 1 },
        user: { select: { id: true, handle: true } },
      },
    });

    // Expand search window slightly to account for timezone differences
    const searchStart = new Date(meeting.confirmedStartTime.getTime() - 24 * 60 * 60 * 1000);
    const searchEnd = new Date(meeting.confirmedEndTime.getTime() + 24 * 60 * 60 * 1000);

    for (const connection of connections) {
      try {
        let accessToken = connection.accessToken;
        if (!accessToken) continue;

        const calendarId = connection.calendars[0]?.externalId || 'primary';

        // Refresh token if expired
        if (connection.expiresAt && connection.expiresAt < new Date() && connection.refreshToken) {
          const provider = connection.provider === 'MICROSOFT'
            ? this.microsoftCalendarProvider
            : this.googleCalendarProvider;
          try {
            const newTokens = await provider.refreshToken(connection.refreshToken);
            accessToken = newTokens.accessToken;
            await this.prisma.calendarConnection.update({
              where: { id: connection.id },
              data: { accessToken: newTokens.accessToken, expiresAt: newTokens.expiresAt },
            });
          } catch (tokenErr: any) {
            this.logger.warn(`Token refresh failed for @${connection.user.handle} during cancel, skipping`);
            continue;
          }
        }

        if (connection.provider === 'GOOGLE') {
          // Google: fetch events and find by boloMeetingId in extended properties
          const events = await this.googleCalendarProvider.getEvents(
            accessToken, calendarId, searchStart, searchEnd,
          );
          const boloEvent = events.find((e: any) => e.boloMeetingId === meetingId);
          if (boloEvent) {
            await this.googleCalendarProvider.deleteEvent(accessToken, calendarId, boloEvent.id);
            this.logger.log(`Deleted Google calendar event for @${connection.user.handle} (meeting ${meetingId})`);
          }
        } else if (connection.provider === 'MICROSOFT') {
          // Microsoft: fetch events and find by Meeting ID in description
          const events = await this.microsoftCalendarProvider.getEvents(
            accessToken, calendarId, searchStart, searchEnd,
          );
          const boloEvent = events.find((e: any) => e.boloMeetingId === meetingId);
          if (boloEvent) {
            await this.microsoftCalendarProvider.deleteEvent(accessToken, calendarId, boloEvent.id);
            this.logger.log(`Deleted Microsoft calendar event for @${connection.user.handle} (meeting ${meetingId})`);
          }
        }
      } catch (err) {
        this.logger.error(`Failed to delete calendar event for @${connection.user.handle}: ${err}`);
        // Continue with other participants — don't fail the cancellation
      }
    }
  }

  /**
   * Update meeting date/time range. Organizer only.
   * Re-triggers auto-schedule after updating.
   */
  async updateMeetingRange(
    meetingId: string,
    userId: string,
    updates: {
      dateRangeStart?: Date;
      dateRangeEnd?: Date;
      timeRangeStart?: number;
      timeRangeEnd?: number;
    },
  ) {
    const meeting = await this.prisma.meetingRequest.findUnique({
      where: { id: meetingId },
    });

    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }

    if (meeting.organizerId !== userId) {
      throw new ForbiddenException('Only the organizer can update the meeting range');
    }

    if (meeting.status === 'CONFIRMED') {
      throw new ForbiddenException('Cannot update range of a confirmed meeting');
    }

    if (meeting.status === 'CANCELLED') {
      throw new ForbiddenException('Cannot update range of a cancelled meeting');
    }

    // Build update data
    const updateData: Record<string, unknown> = {};
    if (updates.dateRangeStart) updateData.dateRangeStart = updates.dateRangeStart;
    if (updates.dateRangeEnd) updateData.dateRangeEnd = updates.dateRangeEnd;
    if (updates.timeRangeStart !== undefined) updateData.customHoursStart = updates.timeRangeStart;
    if (updates.timeRangeEnd !== undefined) updateData.customHoursEnd = updates.timeRangeEnd;

    const updated = await this.prisma.meetingRequest.update({
      where: { id: meetingId },
      data: updateData,
      include: {
        participants: true,
        organizer: { select: { id: true, handle: true, name: true, email: true } },
      },
    });

    this.logger.log(`Meeting ${meetingId} range updated by organizer ${userId}`);

    // Re-try auto-schedule with new range
    await this.tryAutoSchedule(meetingId);

    return updated;
  }

  /**
   * Archive a meeting (soft delete) - hides it from main view but keeps data
   * Organizer archives the entire meeting (changes status)
   * Participants can only hide it from their own view (sets isHidden on participant)
   */
  async archiveMeeting(meetingId: string, userId: string) {
    const meeting = await this.prisma.meetingRequest.findUnique({
      where: { id: meetingId },
      include: {
        participants: {
          where: { userId },
        },
      },
    });

    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }

    // If user is the organizer, archive the entire meeting
    if (meeting.organizerId === userId) {
      this.logger.log(`Organizer ${userId} archived meeting ${meetingId}`);
      return this.prisma.meetingRequest.update({
        where: { id: meetingId },
        data: { status: 'ARCHIVED' },
      });
    }

    // If user is a participant (but not organizer), hide from their view
    const participant = meeting.participants[0];
    if (!participant) {
      throw new ForbiddenException('You are not a participant in this meeting');
    }

    this.logger.log(`Participant ${userId} hiding meeting ${meetingId} from their view`);

    await this.prisma.participant.update({
      where: { id: participant.id },
      data: { isHidden: true },
    });

    return {
      ...meeting,
      hiddenForUser: true,
      message: 'Meeting hidden from your view',
    };
  }

  /**
   * Hard delete a meeting and all related data
   */
  async deleteMeetingPermanently(meetingId: string, userId: string) {
    const meeting = await this.prisma.meetingRequest.findUnique({
      where: { id: meetingId },
      include: { participants: true },
    });

    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }

    if (meeting.organizerId !== userId) {
      throw new ForbiddenException('Only the organizer can delete the meeting');
    }

    // Delete in transaction to ensure all related data is removed
    await this.prisma.$transaction(async (tx) => {
      // Delete invitation tokens
      const participantIds = meeting.participants.map(p => p.id);
      await tx.invitationToken.deleteMany({
        where: { participantId: { in: participantIds } },
      });

      // Delete availability slots
      await tx.availabilitySlot.deleteMany({
        where: { participantId: { in: participantIds } },
      });

      // Delete participants
      await tx.participant.deleteMany({
        where: { meetingRequestId: meetingId },
      });

      // Delete the meeting
      await tx.meetingRequest.delete({
        where: { id: meetingId },
      });
    });

    this.logger.log(`User ${userId} permanently deleted meeting ${meetingId}`);

    return { success: true, message: 'Meeting permanently deleted' };
  }

  /**
   * Create calendar events for all participants with connected calendars.
   * Each participant gets an event on their own calendar.
   * Uses calendar routing rules: if participant has a preferredCalendarId for
   * the organizer, the event is created on that calendar instead of their default.
   */
  private async createCalendarEventsForParticipants(
    meeting: {
      id: string;
      title: string;
      description: string | null;
      confirmedStartTime: Date;
      confirmedEndTime: Date;
      meetingLink: string | null;
      organizerId?: string;
      organizerHandle?: string;
    },
    participants: Array<{
      id: string;
      email: string;
      userId: string | null;
      invitationStatus: string;
    }>,
  ): Promise<void> {
    // Get all attendee emails for the invite list
    const attendeeEmails = participants
      .filter(p => p.invitationStatus === 'APPROVED')
      .map(p => p.email);

    // Find all participants with connected Google calendars
    const participantsWithCalendars = await this.prisma.calendarConnection.findMany({
      where: {
        userId: { in: participants.filter(p => p.userId).map(p => p.userId!) },
        provider: 'GOOGLE',
        isEnabled: true,
      },
      include: {
        calendars: { where: { isSelected: true }, take: 1 },
        user: { select: { id: true, handle: true } },
      },
    });

    this.logger.log(
      `Creating calendar events for ${participantsWithCalendars.length} participants with connected calendars`
    );

    for (const connection of participantsWithCalendars) {
      try {
        let accessToken = connection.accessToken;

        // Refresh token if expired
        if (connection.expiresAt && connection.expiresAt < new Date()) {
          if (connection.refreshToken) {
            this.logger.log(`Refreshing expired token for user ${connection.user.handle}`);
            try {
              const newTokens = await this.googleCalendarProvider.refreshToken(
                connection.refreshToken
              );
              accessToken = newTokens.accessToken;

              await this.prisma.calendarConnection.update({
                where: { id: connection.id },
                data: {
                  accessToken: newTokens.accessToken,
                  expiresAt: newTokens.expiresAt,
                },
              });
            } catch (tokenErr: any) {
              // Handle token failure gracefully - mark connection as broken and skip this user
              await this.handleTokenFailure(
                connection.id,
                connection.userId,
                tokenErr.message || 'Token refresh failed'
              );
              continue;
            }
          } else {
            this.logger.warn(`No refresh token for user ${connection.user.handle}, skipping`);
            continue;
          }
        }

        if (!accessToken) {
          this.logger.warn(`No access token for user ${connection.user.handle}, skipping`);
          continue;
        }

        // Check for calendar routing rules - if this user has a preferredCalendarId
        // for the organizer, use that calendar instead of their default
        let calendarId = connection.calendars[0]?.externalId || 'primary';

        if (meeting.organizerId && meeting.organizerHandle) {
          const routingPrefs = await this.contactsService.isOrganizerTrusted(
            connection.userId,
            meeting.organizerId,
            meeting.organizerHandle,
          );

          if (routingPrefs.preferredCalendarId) {
            // Verify this calendar belongs to one of the user's connections
            const routedCalendar = await this.prisma.calendar.findFirst({
              where: {
                id: routingPrefs.preferredCalendarId,
                connection: { userId: connection.userId },
              },
            });

            if (routedCalendar) {
              calendarId = routedCalendar.externalId;
              this.logger.log(
                `Using routed calendar "${routedCalendar.name}" for user @${connection.user.handle} (organizer: @${meeting.organizerHandle})`
              );
            }
          }
        }

        const event = await this.googleCalendarProvider.createEvent(
          accessToken,
          calendarId,
          {
            title: meeting.title,
            description: meeting.description || undefined,
            startTime: meeting.confirmedStartTime,
            endTime: meeting.confirmedEndTime,
            attendees: attendeeEmails,
            location: meeting.meetingLink || undefined,
            boloMeetingId: meeting.id,
          }
        );

        this.logger.log(
          `Created calendar event ${event.id} for user @${connection.user.handle}`
        );
      } catch (err) {
        this.logger.error(
          `Failed to create calendar event for user ${connection.user.handle}: ${err}`
        );
        // Continue with other participants - don't fail the whole operation
      }
    }
  }

  /**
   * Get incoming meeting requests that need approval
   */
  async getIncomingRequests(userId: string) {
    // Clean up expired invitations for all pending meetings this user is part of
    const pendingMeetings = await this.prisma.participant.findMany({
      where: { userId, invitationStatus: 'PENDING_APPROVAL' },
      select: { meetingRequestId: true },
    });
    for (const p of pendingMeetings) {
      await this.checkAndUpdateExpiredInvitations(p.meetingRequestId);
    }

    const requests = await this.prisma.participant.findMany({
      where: {
        userId,
        invitationStatus: 'PENDING_APPROVAL',
        meetingRequest: {
          status: { not: 'CANCELLED' },
        },
      },
      include: {
        meetingRequest: {
          include: {
            organizer: {
              select: { id: true, handle: true, name: true, email: true },
            },
            participants: {
              select: {
                email: true,
                name: true,
                invitationStatus: true,
                user: { select: { handle: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Transform to match frontend expected shape
    return requests.map(r => ({
      ...r,
      meeting: r.meetingRequest,
    }));
  }

  /**
   * Approve or decline a meeting invitation
   */
  async respondToInvitation(
    participantId: string,
    userId: string,
    response: 'APPROVED' | 'DECLINED',
  ) {
    // Verify the participant belongs to this user
    const participant = await this.prisma.participant.findUnique({
      where: { id: participantId },
      include: {
        meetingRequest: {
          include: {
            organizer: { select: { handle: true, name: true, email: true } },
          },
        },
      },
    });

    if (!participant) {
      throw new NotFoundException('Invitation not found');
    }

    if (participant.userId !== userId) {
      throw new ForbiddenException('You can only respond to your own invitations');
    }

    // Check if this invitation has expired
    if (participant.invitationExpiresAt && participant.invitationExpiresAt < new Date()) {
      await this.checkAndUpdateExpiredInvitations(participant.meetingRequestId);
      throw new ForbiddenException('This invitation has expired');
    }

    if (participant.invitationStatus !== 'PENDING_APPROVAL') {
      throw new ForbiddenException('This invitation has already been responded to');
    }

    // Check if user has a connected calendar (for auto-responding with availability)
    let hasCalendar = false;
    if (response === 'APPROVED') {
      const calendarConnection = await this.prisma.calendarConnection.findFirst({
        where: {
          userId,
          isEnabled: true,
        },
      });
      hasCalendar = !!calendarConnection;
      this.logger.log(`User ${userId} has connected calendar: ${hasCalendar}`);
    }

    // Update the invitation status
    const updated = await this.prisma.participant.update({
      where: { id: participantId },
      data: {
        invitationStatus: response,
        invitationRespondedAt: new Date(),
        // If approved and has calendar, auto-respond with calendar availability
        ...(response === 'APPROVED' && hasCalendar
          ? {
              responseStatus: 'RESPONDED',
              respondedAt: new Date(),
              useConnectedCalendar: true,
            }
          : {}),
        // If declined, also set responseStatus to DECLINED
        ...(response === 'DECLINED' ? { responseStatus: 'DECLINED' } : {}),
      },
      include: {
        meetingRequest: {
          include: {
            organizer: { select: { id: true, handle: true, name: true } },
            participants: {
              select: {
                email: true,
                name: true,
                responseStatus: true,
                invitationStatus: true,
                user: { select: { handle: true } },
              },
            },
          },
        },
      },
    });

    this.logger.log(
      `User ${userId} ${response.toLowerCase()} invitation to meeting "${participant.meetingRequest.title}"`
    );

    // If approved, try to auto-schedule the meeting
    if (response === 'APPROVED') {
      this.logger.log(`Triggering auto-schedule for meeting ${participant.meetingRequestId}`);
      await this.tryAutoSchedule(participant.meetingRequestId);
    }

    // If declined, notify the organizer
    if (response === 'DECLINED') {
      // Get participant's user info for the notification
      const declinedUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { handle: true, name: true },
      });

      await this.emailService.sendDeclineNotification(
        participant.meetingRequest.organizer.email,
        {
          participantName: declinedUser?.name || participant.name || participant.email,
          participantHandle: declinedUser?.handle,
          participantEmail: participant.email,
          meetingTitle: participant.meetingRequest.title,
          meetingId: participant.meetingRequestId,
        }
      );

      this.logger.log(
        `Sent decline notification to organizer ${participant.meetingRequest.organizer.email}`
      );
    }

    return updated;
  }

  /**
   * Resend invitation email to a participant
   */
  /**
   * Withdraw from a confirmed meeting as a participant.
   * This updates the participant's status in Bolo without needing calendar sync.
   */
  async withdrawFromMeeting(meetingId: string, userId: string) {
    // Find the meeting
    const meeting = await this.prisma.meetingRequest.findUnique({
      where: { id: meetingId },
      include: {
        participants: {
          where: { userId },
        },
        organizer: { select: { id: true, handle: true, name: true, email: true } },
      },
    });

    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }

    // Must be a confirmed meeting
    if (meeting.status !== 'CONFIRMED') {
      throw new ForbiddenException('Can only withdraw from confirmed meetings. Use decline for pending meetings.');
    }

    const participant = meeting.participants[0];
    if (!participant) {
      throw new NotFoundException('You are not a participant in this meeting');
    }

    // Organizer should cancel instead of withdraw
    if (participant.role === 'ORGANIZER') {
      throw new ForbiddenException('As the organizer, please cancel the meeting instead of withdrawing');
    }

    // Already declined
    if (participant.responseStatus === 'DECLINED') {
      throw new ForbiddenException('You have already withdrawn from this meeting');
    }

    // Update participant status
    const updated = await this.prisma.participant.update({
      where: { id: participant.id },
      data: {
        responseStatus: 'DECLINED',
        respondedAt: new Date(),
      },
    });

    this.logger.log(`User ${userId} withdrew from confirmed meeting ${meetingId}`);

    // Notify the organizer
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { handle: true, name: true },
    });

    await this.emailService.sendDeclineNotification(
      meeting.organizer.email,
      {
        participantName: user?.name || participant.name || participant.email,
        participantHandle: user?.handle,
        participantEmail: participant.email,
        meetingTitle: meeting.title,
        meetingId: meeting.id,
      }
    );

    this.logger.log(`Sent withdrawal notification to organizer ${meeting.organizer.email}`);

    return {
      success: true,
      message: 'Successfully withdrew from meeting. The organizer has been notified.',
    };
  }

  /**
   * Called when a user connects their calendar.
   * Updates any pending meeting invitations to mark them as responded
   * since we can now use their calendar for availability.
   */
  async onCalendarConnected(userId: string): Promise<number> {
    this.logger.log(`Calendar connected for user ${userId} - checking pending invitations`);

    // Find all pending invitations for this user
    const pendingParticipants = await this.prisma.participant.findMany({
      where: {
        userId,
        responseStatus: 'PENDING',
        invitationStatus: 'APPROVED', // Only update approved invitations
        meetingRequest: {
          status: 'PENDING',
        },
      },
      include: {
        meetingRequest: {
          select: { id: true, title: true },
        },
      },
    });

    if (pendingParticipants.length === 0) {
      this.logger.log(`No pending invitations found for user ${userId}`);
      return 0;
    }

    this.logger.log(`Found ${pendingParticipants.length} pending invitations to update`);

    // Update all pending participants to RESPONDED
    await this.prisma.participant.updateMany({
      where: {
        id: { in: pendingParticipants.map(p => p.id) },
      },
      data: {
        responseStatus: 'RESPONDED',
        respondedAt: new Date(),
        useConnectedCalendar: true,
      },
    });

    // Try auto-schedule for each affected meeting
    const meetingIds = [...new Set(pendingParticipants.map(p => p.meetingRequestId))];
    for (const meetingId of meetingIds) {
      this.logger.log(`Triggering auto-schedule for meeting ${meetingId} after calendar connect`);
      await this.tryAutoSchedule(meetingId);
    }

    return pendingParticipants.length;
  }

  async resendInvite(meetingId: string, participantId: string, organizerId: string) {
    // Verify the meeting exists and user is the organizer
    const meeting = await this.prisma.meetingRequest.findUnique({
      where: { id: meetingId },
      include: {
        organizer: { select: { id: true, handle: true, name: true, email: true } },
        participants: { where: { id: participantId } },
      },
    });

    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }

    if (meeting.organizerId !== organizerId) {
      throw new ForbiddenException('Only the organizer can resend invites');
    }

    const participant = meeting.participants[0];
    if (!participant) {
      throw new NotFoundException('Participant not found');
    }

    // Don't resend to organizer
    if (participant.role === 'ORGANIZER') {
      throw new ForbiddenException('Cannot resend invite to organizer');
    }

    // If participant was declined, reset their status to allow re-invitation
    const wasDeclined = participant.responseStatus === 'DECLINED' || participant.invitationStatus === 'DECLINED';
    if (wasDeclined) {
      this.logger.log(`Re-inviting declined participant ${participant.email} - resetting status`);

      // Reset status based on whether it's a Bolo user or external user
      if (participant.userId) {
        // Bolo user - reset to pending approval
        await this.prisma.participant.update({
          where: { id: participant.id },
          data: {
            responseStatus: 'PENDING',
            invitationStatus: 'PENDING_APPROVAL',
          },
        });
      } else {
        // External user - reset response status
        await this.prisma.participant.update({
          where: { id: participant.id },
          data: {
            responseStatus: 'PENDING',
          },
        });
      }
    }

    // Clear any stale availability slots from previous submissions
    const deletedSlots = await this.prisma.availabilitySlot.deleteMany({
      where: { participantId: participant.id },
    });
    if (deletedSlots.count > 0) {
      this.logger.log(`Cleared ${deletedSlots.count} stale availability slots for participant ${participant.email}`);
    }

    // Reset response status to PENDING if they had previously responded
    if (participant.responseStatus === 'RESPONDED') {
      await this.prisma.participant.update({
        where: { id: participant.id },
        data: {
          responseStatus: 'PENDING',
          respondedAt: null,
        },
      });
      this.logger.log(`Reset response status to PENDING for ${participant.email}`);
    }

    // Invalidate any existing invitation tokens for this participant
    await this.prisma.invitationToken.updateMany({
      where: {
        participantId: participant.id,
        usedAt: null,
      },
      data: {
        usedAt: new Date(), // Mark as used so old links don't work
      },
    });

    // Create new invitation token
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const invitationToken = await this.prisma.invitationToken.create({
      data: {
        participantId: participant.id,
        expiresAt,
      },
    });

    // Format date range for email
    const dateRange = `${meeting.dateRangeStart.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    })} - ${meeting.dateRangeEnd.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    })}`;

    // Send email
    const respondUrl = `${this.appUrl}/invite/${invitationToken.token}`;
    const emailResult = await this.emailService.sendMeetingInvite(participant.email, {
      organizerName: meeting.organizer.name || meeting.organizer.handle,
      organizerHandle: meeting.organizer.handle,
      meetingTitle: meeting.title,
      proposedTime: dateRange,
      inviteToken: invitationToken.token,
      respondUrl,
    });

    // Update token with email status
    await this.prisma.invitationToken.update({
      where: { id: invitationToken.id },
      data: {
        emailSentAt: emailResult.success ? new Date() : null,
        emailStatus: emailResult.success ? 'SENT' : 'FAILED',
        emailMessageId: emailResult.messageId ?? null,
        emailError: emailResult.error ?? null,
        emailRetryCount: { increment: 1 },
        lastRetryAt: new Date(),
      },
    });

    this.logger.log(
      `${wasDeclined ? 'Re-invited' : 'Resent invitation'} email ${emailResult.success ? 'successfully' : 'failed'} to ${participant.email} for meeting ${meetingId}${emailResult.error ? `: ${emailResult.error}` : ''}`
    );

    return {
      success: emailResult.success,
      participantEmail: participant.email,
      inviteUrl: respondUrl,
      wasReInvited: wasDeclined,
      error: emailResult.error,
    };
  }

  /**
   * Get email delivery status for all participants in a meeting
   */
  async getEmailStatus(meetingId: string, userId: string) {
    const meeting = await this.prisma.meetingRequest.findUnique({
      where: { id: meetingId },
      include: {
        participants: {
          include: {
            invitationToken: true,
            user: { select: { handle: true, name: true } },
          },
        },
      },
    });

    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }

    if (meeting.organizerId !== userId) {
      throw new ForbiddenException('Only the organizer can view email status');
    }

    return {
      meetingId: meeting.id,
      participants: meeting.participants.map(p => ({
        id: p.id,
        email: p.email,
        name: p.user?.name || p.email,
        handle: p.user?.handle || null,
        isBoloUser: !!p.userId,
        responseStatus: p.responseStatus,
        emailStatus: p.invitationToken?.emailStatus || (p.userId ? 'NOT_REQUIRED' : 'PENDING'),
        emailError: p.invitationToken?.emailError || null,
        emailSentAt: p.invitationToken?.emailSentAt || null,
        emailRetryCount: p.invitationToken?.emailRetryCount || 0,
        lastRetryAt: p.invitationToken?.lastRetryAt || null,
      })),
      summary: {
        total: meeting.participants.length,
        sent: meeting.participants.filter(p => p.invitationToken?.emailStatus === 'SENT').length,
        failed: meeting.participants.filter(p => p.invitationToken?.emailStatus === 'FAILED').length,
        pending: meeting.participants.filter(p => p.invitationToken?.emailStatus === 'PENDING').length,
        notRequired: meeting.participants.filter(p => p.userId && !p.invitationToken).length,
      },
    };
  }

  /**
   * Retry sending emails to all participants with failed delivery
   */
  async retryFailedEmails(meetingId: string, userId: string) {
    const meeting = await this.prisma.meetingRequest.findUnique({
      where: { id: meetingId },
      include: {
        organizer: true,
        participants: {
          include: {
            invitationToken: true,
          },
        },
      },
    });

    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }

    if (meeting.organizerId !== userId) {
      throw new ForbiddenException('Only the organizer can retry failed emails');
    }

    // Find participants with failed emails
    const failedParticipants = meeting.participants.filter(
      p => p.invitationToken?.emailStatus === 'FAILED'
    );

    if (failedParticipants.length === 0) {
      return {
        message: 'No failed emails to retry',
        retried: 0,
        succeeded: 0,
        failed: 0,
      };
    }

    const results = await Promise.all(
      failedParticipants.map(p => this.resendInvite(meetingId, p.id, userId))
    );

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    return {
      message: `Retried ${results.length} failed emails`,
      retried: results.length,
      succeeded,
      failed,
      details: results,
    };
  }

  // --- Hours Override Request Methods ---

  async requestHoursOverride(
    meetingId: string,
    organizerId: string,
    targetUserId: string,
    requestedStart: number,
    requestedEnd: number,
    requestedDays?: number[],
    reason?: string,
  ) {
    // Verify organizer owns the meeting
    const meeting = await this.prisma.meetingRequest.findUnique({
      where: { id: meetingId },
      include: { participants: true },
    });

    if (!meeting) throw new NotFoundException('Meeting not found');
    if (meeting.organizerId !== organizerId) throw new ForbiddenException('Only the organizer can request overrides');
    if (meeting.status !== 'PENDING') throw new ForbiddenException('Can only request overrides for pending meetings');

    // Verify target is a participant
    const targetParticipant = meeting.participants.find(p => p.userId === targetUserId);
    if (!targetParticipant) throw new NotFoundException('Target user is not a participant in this meeting');

    // Validate hours
    if (requestedStart < 0 || requestedStart > 23 || requestedEnd < 0 || requestedEnd > 23) {
      throw new BadRequestException('Hours must be between 0 and 23');
    }
    if (requestedStart >= requestedEnd) {
      throw new BadRequestException('Start hour must be less than end hour');
    }

    // Check if target allows override requests from this organizer
    const organizer = await this.prisma.user.findUnique({
      where: { id: organizerId },
      select: { id: true, handle: true },
    });

    const contactHours = await this.contactsService.getContactBookableHours(
      targetUserId,
      organizerId,
      organizer?.handle || '',
    );

    if (!contactHours.allowOverrideRequest) {
      throw new ForbiddenException('This contact does not allow override requests');
    }

    // Create override request with 48-hour expiration
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    return this.prisma.hoursOverrideRequest.create({
      data: {
        meetingRequestId: meetingId,
        requestorUserId: organizerId,
        targetUserId,
        requestedStart,
        requestedEnd,
        requestedDays: requestedDays ?? [],
        reason,
        status: 'PENDING',
        expiresAt,
      },
    });
  }

  async respondToHoursOverride(
    overrideId: string,
    userId: string,
    response: 'APPROVED' | 'DECLINED',
    responseNote?: string,
  ) {
    const override = await this.prisma.hoursOverrideRequest.findUnique({
      where: { id: overrideId },
    });

    if (!override) throw new NotFoundException('Override request not found');
    if (override.targetUserId !== userId) throw new ForbiddenException('Only the target user can respond');
    if (override.status !== 'PENDING') throw new ForbiddenException('Override request already responded to');

    // Check expiration
    if (override.expiresAt < new Date()) {
      await this.prisma.hoursOverrideRequest.update({
        where: { id: overrideId },
        data: { status: 'EXPIRED' },
      });
      throw new ForbiddenException('Override request has expired');
    }

    const updated = await this.prisma.hoursOverrideRequest.update({
      where: { id: overrideId },
      data: {
        status: response,
        respondedAt: new Date(),
        responseNote,
      },
    });

    // If approved, re-trigger auto-scheduling with wider hours
    if (response === 'APPROVED') {
      this.logger.log(`Override approved for meeting ${override.meetingRequestId}, re-triggering scheduling`);
      await this.tryAutoSchedule(override.meetingRequestId);
    }

    return updated;
  }

  async getHoursOverrideRequests(userId: string, filter?: 'pending' | 'all') {
    const where: Record<string, unknown> = { targetUserId: userId };
    if (filter === 'pending') {
      where.status = 'PENDING';
      where.expiresAt = { gt: new Date() };
    }

    return this.prisma.hoursOverrideRequest.findMany({
      where,
      include: {
        meetingRequest: {
          select: { id: true, title: true, duration: true, dateRangeStart: true, dateRangeEnd: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
