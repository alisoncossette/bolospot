import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { CalendarProvider } from '@prisma/client';
import { GoogleCalendarProvider } from '../../providers/google/google-calendar.provider';
import { MicrosoftCalendarProvider } from '../../providers/microsoft/microsoft-calendar.provider';

@Injectable()
export class ConnectionsService {
  private readonly logger = new Logger(ConnectionsService.name);
  private busySyncLocks = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private googleProvider: GoogleCalendarProvider,
    private microsoftProvider: MicrosoftCalendarProvider,
  ) {}

  async listConnections(userId: string) {
    return this.prisma.calendarConnection.findMany({
      where: { userId, isEnabled: true },
      select: {
        id: true,
        provider: true,
        accountEmail: true,
        isPrimary: true,
        lastSyncedAt: true,
        syncStatus: true,
        syncError: true,
        createdAt: true,
        calendars: {
          select: {
            id: true,
            externalId: true,
            name: true,
            color: true,
            isPrimary: true,
            isSelected: true,
            isBusyBlock: true,
          },
        },
      },
    });
  }

  async getUserById(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        needsOnboarding: true,
      },
    });
  }

  async hasConnectedCalendar(userId: string): Promise<boolean> {
    const count = await this.prisma.calendarConnection.count({
      where: { userId, isEnabled: true },
    });
    return count > 0;
  }

  async getConnection(userId: string, connectionId: string) {
    const connection = await this.prisma.calendarConnection.findFirst({
      where: { id: connectionId, userId },
      include: {
        calendars: true,
      },
    });
    if (!connection) {
      throw new NotFoundException('Connection not found');
    }
    return connection;
  }

  async getGoogleAuthUrl(userId: string, redirectUri: string, returnUrl?: string) {
    const clientId = this.configService.get('GOOGLE_CLIENT_ID');
    const scopes = [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events',
    ].join(' ');

    const state = Buffer.from(JSON.stringify({ userId, returnUrl })).toString('base64');

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes,
      access_type: 'offline',
      prompt: 'consent',
      state,
    });

    return {
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    };
  }

  async handleGoogleCallback(code: string, redirectUri: string, state: string) {
    const { userId } = JSON.parse(Buffer.from(state, 'base64').toString());

    const clientId = this.configService.get('GOOGLE_CLIENT_ID');
    const clientSecret = this.configService.get('GOOGLE_CLIENT_SECRET');

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      throw new BadRequestException('Failed to exchange code for tokens');
    }

    const tokens = await tokenResponse.json();

    // Get user's Google profile to get account ID
    const profileResponse = await fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      },
    );

    if (!profileResponse.ok) {
      throw new BadRequestException('Failed to get Google profile');
    }

    const profile = await profileResponse.json();

    // Upsert connection
    const connection = await this.prisma.calendarConnection.upsert({
      where: {
        userId_provider_providerAccountId: {
          userId,
          provider: CalendarProvider.GOOGLE,
          providerAccountId: profile.id,
        },
      },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || undefined,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        scope: tokens.scope,
        accountEmail: profile.email,
        syncStatus: 'PENDING',
      },
      create: {
        userId,
        provider: CalendarProvider.GOOGLE,
        providerAccountId: profile.id,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        scope: tokens.scope,
        accountEmail: profile.email,
        syncStatus: 'PENDING',
      },
    });

    // Create a booking profile for this connection
    this.ensureBookingProfileForConnection(userId, connection.id).catch((err) => {
      this.logger.error(`Failed to create booking profile for connection: ${err.message}`);
    });

    // Auto-grant self calendar access (so owner's MCP agent can read their own calendar)
    this.ensureSelfCalendarGrant(userId).catch((err) => {
      this.logger.warn(`Failed to auto-grant calendar self-access: ${err.message}`);
    });

    // Create UserIdentity for the Google account (verified since OAuth succeeded)
    const googleIdentityType = await this.prisma.identityType.findUnique({
      where: { code: 'GOOGLE' },
    });

    if (googleIdentityType && profile.email) {
      await this.prisma.userIdentity.upsert({
        where: {
          identityTypeId_value: {
            identityTypeId: googleIdentityType.id,
            value: profile.email.toLowerCase(),
          },
        },
        update: {
          isVerified: true,
          verifiedAt: new Date(),
          metadata: {
            googleId: profile.id,
            name: profile.name,
            picture: profile.picture,
          },
        },
        create: {
          userId,
          identityTypeId: googleIdentityType.id,
          value: profile.email.toLowerCase(),
          displayValue: profile.email,
          isPrimary: false,
          isVerified: true,
          verifiedAt: new Date(),
          visibility: 'BOLO_ONLY',
          metadata: {
            googleId: profile.id,
            name: profile.name,
            picture: profile.picture,
          },
        },
      });

      // Also verify the user's EMAIL identity if it matches the OAuth email
      const emailIdentityType = await this.prisma.identityType.findUnique({
        where: { code: 'EMAIL' },
      });
      if (emailIdentityType) {
        await this.prisma.userIdentity.updateMany({
          where: {
            userId,
            identityTypeId: emailIdentityType.id,
            value: profile.email.toLowerCase(),
            isVerified: false,
          },
          data: {
            isVerified: true,
            verifiedAt: new Date(),
          },
        });
      }
    }

    return connection;
  }

  async deleteConnection(userId: string, connectionId: string) {
    const connection = await this.prisma.calendarConnection.findFirst({
      where: { id: connectionId, userId },
    });
    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    // Deactivate any booking profiles tied to this connection
    await this.prisma.bookingProfile.updateMany({
      where: { userId, connectionId },
      data: { isActive: false },
    });

    await this.prisma.calendarConnection.delete({
      where: { id: connectionId },
    });

    return { success: true };
  }

  // Create a Google calendar connection directly from access/refresh tokens
  // Used when the user signs in with Google — we already have their tokens
  async createConnectionFromGoogleTokens(
    userId: string,
    tokens: { access_token: string; refresh_token?: string; expires_in?: number; scope?: string },
    profile: { id: string; email: string },
  ) {
    try {
      const connection = await this.prisma.calendarConnection.upsert({
        where: {
          userId_provider_providerAccountId: {
            userId,
            provider: CalendarProvider.GOOGLE,
            providerAccountId: profile.id,
          },
        },
        update: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || undefined,
          expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : undefined,
          scope: tokens.scope,
          accountEmail: profile.email,
          syncStatus: 'PENDING',
        },
        create: {
          userId,
          provider: CalendarProvider.GOOGLE,
          providerAccountId: profile.id,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || null,
          expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
          scope: tokens.scope || null,
          accountEmail: profile.email,
          syncStatus: 'PENDING',
        },
      });

      // Create booking profile and self-grant in background
      this.ensureBookingProfileForConnection(userId, connection.id).catch((err) => {
        this.logger.warn(`createConnectionFromGoogleTokens: booking profile: ${err.message}`);
      });
      this.ensureSelfCalendarGrant(userId).catch((err) => {
        this.logger.warn(`createConnectionFromGoogleTokens: self-grant: ${err.message}`);
      });

      this.logger.log(`Auto-created calendar connection for user ${userId} from Google login`);
      return connection;
    } catch (err) {
      this.logger.warn(`createConnectionFromGoogleTokens failed (non-fatal): ${err.message}`);
      return null;
    }
  }

  async getMicrosoftAuthUrl(userId: string, redirectUri: string) {
    const clientId = this.configService.get('MICROSOFT_CLIENT_ID');
    const scopes = [
      'offline_access',
      'User.Read',
      'Calendars.Read',
      'Calendars.ReadWrite',
    ].join(' ');

    const state = Buffer.from(JSON.stringify({ userId })).toString('base64');

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes,
      response_mode: 'query',
      state,
    });

    return {
      url: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`,
    };
  }

  async handleMicrosoftCallback(code: string, redirectUri: string, state: string) {
    const { userId } = JSON.parse(Buffer.from(state, 'base64').toString());

    const clientId = this.configService.get('MICROSOFT_CLIENT_ID');
    const clientSecret = this.configService.get('MICROSOFT_CLIENT_SECRET');

    // Exchange code for tokens
    const tokenResponse = await fetch(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      },
    );

    if (!tokenResponse.ok) {
      throw new BadRequestException('Failed to exchange code for tokens');
    }

    const tokens = await tokenResponse.json();

    // Get user's Microsoft profile
    const profileResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!profileResponse.ok) {
      throw new BadRequestException('Failed to get Microsoft profile');
    }

    const profile = await profileResponse.json();

    // Upsert connection
    const accountEmail = profile.mail || profile.userPrincipalName;
    const connection = await this.prisma.calendarConnection.upsert({
      where: {
        userId_provider_providerAccountId: {
          userId,
          provider: CalendarProvider.MICROSOFT,
          providerAccountId: profile.id,
        },
      },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || undefined,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        scope: tokens.scope,
        accountEmail,
        syncStatus: 'PENDING',
      },
      create: {
        userId,
        provider: CalendarProvider.MICROSOFT,
        providerAccountId: profile.id,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        scope: tokens.scope,
        accountEmail,
        syncStatus: 'PENDING',
      },
    });

    // Create a booking profile for this connection
    this.ensureBookingProfileForConnection(userId, connection.id).catch((err) => {
      this.logger.error(`Failed to create booking profile for connection: ${err.message}`);
    });

    // Create UserIdentity for the Microsoft account (verified since OAuth succeeded)
    const microsoftIdentityType = await this.prisma.identityType.findUnique({
      where: { code: 'MICROSOFT' },
    });

    if (microsoftIdentityType && accountEmail) {
      await this.prisma.userIdentity.upsert({
        where: {
          identityTypeId_value: {
            identityTypeId: microsoftIdentityType.id,
            value: accountEmail.toLowerCase(),
          },
        },
        update: {
          isVerified: true,
          verifiedAt: new Date(),
          metadata: {
            microsoftId: profile.id,
            displayName: profile.displayName,
          },
        },
        create: {
          userId,
          identityTypeId: microsoftIdentityType.id,
          value: accountEmail.toLowerCase(),
          displayValue: accountEmail,
          isPrimary: false,
          isVerified: true,
          verifiedAt: new Date(),
          visibility: 'BOLO_ONLY',
          metadata: {
            microsoftId: profile.id,
            displayName: profile.displayName,
          },
        },
      });

      // Also verify the user's EMAIL identity if it matches the OAuth email
      const emailIdentityType = await this.prisma.identityType.findUnique({
        where: { code: 'EMAIL' },
      });
      if (emailIdentityType) {
        await this.prisma.userIdentity.updateMany({
          where: {
            userId,
            identityTypeId: emailIdentityType.id,
            value: accountEmail.toLowerCase(),
            isVerified: false,
          },
          data: {
            isVerified: true,
            verifiedAt: new Date(),
          },
        });
      }
    }

    return connection;
  }

  async syncConnection(userId: string, connectionId: string) {
    const connection = await this.prisma.calendarConnection.findFirst({
      where: { id: connectionId, userId },
    });

    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    // Update status to syncing
    await this.prisma.calendarConnection.update({
      where: { id: connectionId },
      data: { syncStatus: 'SYNCING' },
    });

    try {
      let accessToken: string = connection.accessToken ?? '';

      if (!accessToken) {
        throw new Error('No access token available');
      }

      // Check if token needs refresh
      if (connection.expiresAt && connection.expiresAt < new Date()) {
        if (!connection.refreshToken) {
          throw new Error('No refresh token available');
        }

        // Use appropriate provider for token refresh
        if (connection.provider === CalendarProvider.MICROSOFT) {
          const newTokens = await this.microsoftProvider.refreshToken(connection.refreshToken);
          accessToken = newTokens.accessToken;
          await this.prisma.calendarConnection.update({
            where: { id: connectionId },
            data: {
              accessToken: newTokens.accessToken,
              expiresAt: newTokens.expiresAt,
            },
          });
        } else {
          const newTokens = await this.googleProvider.refreshToken(connection.refreshToken);
          accessToken = newTokens.accessToken;
          await this.prisma.calendarConnection.update({
            where: { id: connectionId },
            data: {
              accessToken: newTokens.accessToken,
              expiresAt: newTokens.expiresAt,
            },
          });
        }
      }

      // Fetch calendars from the appropriate provider
      let calendars;
      if (connection.provider === CalendarProvider.MICROSOFT) {
        calendars = await this.microsoftProvider.getCalendars(accessToken);
      } else {
        calendars = await this.googleProvider.getCalendars(accessToken);
      }

      // Upsert calendars
      for (const cal of calendars) {
        await this.prisma.calendar.upsert({
          where: {
            connectionId_externalId: {
              connectionId: connectionId,
              externalId: cal.id,
            },
          },
          update: {
            name: cal.name,
            description: cal.description,
            color: cal.color,
            isPrimary: cal.isPrimary,
            accessRole: cal.accessRole,
          },
          create: {
            connectionId: connectionId,
            externalId: cal.id,
            name: cal.name,
            description: cal.description,
            color: cal.color,
            isPrimary: cal.isPrimary,
            accessRole: cal.accessRole,
            isSelected: cal.isPrimary, // Only select primary by default
          },
        });
      }

      // NOTE: We intentionally do NOT fetch/store actual calendar events.
      // Bolo uses Google's Free/Busy API to check availability without
      // seeing event details (titles, descriptions, locations).
      // This is a privacy-first approach - we only know WHEN you're busy,
      // not WHAT you're doing.

      // Update sync status
      await this.prisma.calendarConnection.update({
        where: { id: connectionId },
        data: {
          syncStatus: 'SYNCED',
          lastSyncedAt: new Date(),
          syncError: null,
        },
      });

      // Trigger busy block sync in background after calendar sync
      this.syncBusyBlocks(userId).catch(err => {
        this.logger.error(`Background busy block sync failed: ${err.message}`);
      });

      return { success: true, calendarsCount: calendars.length };
    } catch (error) {
      // Update sync status to error
      await this.prisma.calendarConnection.update({
        where: { id: connectionId },
        data: {
          syncStatus: 'ERROR',
          syncError: error.message,
        },
      });

      throw new BadRequestException(`Sync failed: ${error.message}`);
    }
  }

  async toggleSelected(userId: string, calendarId: string, isSelected: boolean) {
    const calendar = await this.prisma.calendar.findFirst({
      where: {
        id: calendarId,
        connection: { userId },
      },
    });

    if (!calendar) {
      throw new NotFoundException('Calendar not found');
    }

    return this.prisma.calendar.update({
      where: { id: calendarId },
      data: { isSelected },
    });
  }

  async toggleBusyBlock(userId: string, calendarId: string, isBusyBlock: boolean) {
    const calendar = await this.prisma.calendar.findFirst({
      where: {
        id: calendarId,
        connection: { userId },
      },
    });

    if (!calendar) {
      throw new NotFoundException('Calendar not found');
    }

    const updated = await this.prisma.calendar.update({
      where: { id: calendarId },
      data: { isBusyBlock },
    });

    // Trigger busy block sync in background when enabled
    if (isBusyBlock) {
      this.syncBusyBlocks(userId).catch(err => {
        this.logger.error(`Background busy block sync failed: ${err.message}`);
      });
    }

    return updated;
  }

  /**
   * Called after a calendar is connected.
   * Updates any pending meeting invitations to mark them as responded
   * since we can now use their calendar for availability.
   */
  async updatePendingInvitationsOnConnect(userId: string): Promise<number> {
    this.logger.log(`Calendar connected for user ${userId} - checking pending invitations`);

    // Find all pending invitations for this user where they've approved but not responded
    const pendingParticipants = await this.prisma.participant.findMany({
      where: {
        userId,
        responseStatus: 'PENDING',
        invitationStatus: 'APPROVED',
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

    // Update all pending participants to RESPONDED with calendar
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

    this.logger.log(`Updated ${pendingParticipants.length} invitations to RESPONDED`);
    return pendingParticipants.length;
  }

  /**
   * Sync busy blocks across calendars.
   * For each calendar with isBusyBlock=true, fetch busy times from all OTHER
   * calendars and create "Busy" events on the target calendar.
   */
  async syncBusyBlocks(userId: string): Promise<{ synced: number; errors: string[] }> {
    // Per-user lock to prevent concurrent syncs causing duplicates
    if (this.busySyncLocks.has(userId)) {
      this.logger.log(`Busy block sync already running for user ${userId}, skipping`);
      return { synced: 0, errors: [] };
    }

    this.busySyncLocks.add(userId);
    try {
      return await this._doSyncBusyBlocks(userId);
    } finally {
      this.busySyncLocks.delete(userId);
    }
  }

  private async _doSyncBusyBlocks(userId: string): Promise<{ synced: number; errors: string[] }> {
    this.logger.log(`Starting busy block sync for user ${userId}`);

    // Get user's custom busy block title
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { busyBlockTitle: true },
    });
    const busyBlockTitle = user?.busyBlockTitle || 'Busy (Bolo)';

    const connections = await this.prisma.calendarConnection.findMany({
      where: { userId, isEnabled: true },
      include: { calendars: true },
    });

    if (connections.length === 0) {
      return { synced: 0, errors: [] };
    }

    // Sync window: now to 2 weeks out
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 14);

    // Collect all calendars across all connections, with their connection info
    const allCalendars: Array<{
      calendar: any;
      connection: any;
      accessToken: string;
    }> = [];

    // Ensure valid tokens and build calendar list
    for (const connection of connections) {
      try {
        const accessToken = await this.ensureValidTokenForConnection(connection);
        for (const calendar of connection.calendars) {
          allCalendars.push({ calendar, connection, accessToken });
        }
      } catch (error) {
        this.logger.error(`Failed to get token for connection ${connection.id}: ${error.message}`);
      }
    }

    // Find target calendars (isBusyBlock = true)
    const targets = allCalendars.filter(c => c.calendar.isBusyBlock);
    if (targets.length === 0) {
      this.logger.log('No busy block targets found');
      return { synced: 0, errors: [] };
    }

    // Get source calendars (all calendars that are NOT the target)
    const errors: string[] = [];
    let synced = 0;

    for (const target of targets) {
      try {
        // Get busy times from all OTHER calendars
        const busySlots: Array<{ start: Date; end: Date; sourceName: string }> = [];

        for (const source of allCalendars) {
          // Skip the target calendar itself
          if (source.calendar.id === target.calendar.id) continue;

          try {
            const events = source.connection.provider === 'GOOGLE'
              ? await this.googleProvider.getEvents(
                  source.accessToken,
                  source.calendar.externalId,
                  startDate,
                  endDate,
                )
              : await this.microsoftProvider.getEvents(
                  source.accessToken,
                  source.calendar.externalId,
                  startDate,
                  endDate,
                );

            for (const event of events) {
              // Skip busy block events created by Bolo sync to avoid feedback loops
              if (event.title === busyBlockTitle || event.title === 'Busy (Bolo)') continue;
              // Only sync non-free, non-cancelled events
              if (event.showAs === 'FREE' || event.status === 'CANCELLED') continue;
              if (event.isAllDay) continue; // Skip all-day events to avoid clutter

              const eventStart = event.startTime instanceof Date
                ? event.startTime
                : new Date(event.startTime);
              const eventEnd = event.endTime instanceof Date
                ? event.endTime
                : new Date(event.endTime);

              busySlots.push({
                start: eventStart,
                end: eventEnd,
                sourceName: source.calendar.name,
              });
            }
          } catch (error) {
            this.logger.error(`Failed to fetch events from ${source.calendar.name}: ${error.message}`);
          }
        }

        if (busySlots.length === 0) {
          this.logger.log(`No busy slots to sync to ${target.calendar.name}`);
        }

        // Delete existing busy blocks on the target
        const existingBlocks = target.connection.provider === 'GOOGLE'
          ? await this.googleProvider.listBusyBlockEvents(
              target.accessToken,
              target.calendar.externalId,
              startDate,
              endDate,
            )
          : await this.microsoftProvider.listBusyBlockEvents(
              target.accessToken,
              target.calendar.externalId,
              startDate,
              endDate,
            );

        this.logger.log(`Deleting ${existingBlocks.length} old busy blocks from ${target.calendar.name}`);
        for (const block of existingBlocks) {
          if (target.connection.provider === 'GOOGLE') {
            await this.googleProvider.deleteEvent(
              target.accessToken,
              target.calendar.externalId,
              block.id,
            );
          } else {
            await this.microsoftProvider.deleteEvent(
              target.accessToken,
              target.calendar.externalId,
              block.id,
            );
          }
        }

        // Merge overlapping busy slots to reduce event count
        const merged = this.mergeBusySlots(busySlots);

        // Create new busy blocks
        this.logger.log(`Creating ${merged.length} busy blocks on ${target.calendar.name}`);
        for (const slot of merged) {
          try {
            if (target.connection.provider === 'GOOGLE') {
              await this.googleProvider.createBusyBlock(
                target.accessToken,
                target.calendar.externalId,
                slot.start,
                slot.end,
                slot.sourceName,
                busyBlockTitle,
              );
            } else {
              await this.microsoftProvider.createBusyBlock(
                target.accessToken,
                target.calendar.externalId,
                slot.start,
                slot.end,
                slot.sourceName,
                busyBlockTitle,
              );
            }
            synced++;
          } catch (error) {
            this.logger.error(`Failed to create busy block: ${error.message}`);
            errors.push(`Failed to create block on ${target.calendar.name}: ${error.message}`);
          }
        }
      } catch (error) {
        this.logger.error(`Failed to sync busy blocks for ${target.calendar.name}: ${error.message}`);
        errors.push(`${target.calendar.name}: ${error.message}`);
      }
    }

    this.logger.log(`Busy block sync complete: ${synced} blocks created, ${errors.length} errors`);
    return { synced, errors };
  }

  private async ensureValidTokenForConnection(connection: any): Promise<string> {
    if (!connection.accessToken) {
      throw new Error('No access token available');
    }

    const bufferMs = 5 * 60 * 1000;
    const tokenExpiresSoon =
      connection.expiresAt &&
      connection.expiresAt.getTime() - Date.now() < bufferMs;

    if (tokenExpiresSoon) {
      if (!connection.refreshToken) {
        throw new Error('Token expired and no refresh token available');
      }

      const newTokens = connection.provider === 'GOOGLE'
        ? await this.googleProvider.refreshToken(connection.refreshToken)
        : await this.microsoftProvider.refreshToken(connection.refreshToken);

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

  async ensureBookingProfileForConnection(userId: string, connectionId: string): Promise<void> {
    const connection = await this.prisma.calendarConnection.findUnique({
      where: { id: connectionId },
      select: { id: true, accountEmail: true, provider: true },
    });
    if (!connection) return;

    // Don't create duplicate profiles for same connection
    const existing = await this.prisma.bookingProfile.findFirst({
      where: { userId, connectionId },
    });
    if (existing) return;

    // First connected calendar becomes the public doorstep default; all subsequent are private (slug-accessible only)
    const hasPublicProfile = await this.prisma.bookingProfile.findFirst({
      where: { userId, visibility: 'PUBLIC', isActive: true },
    });
    const visibility = hasPublicProfile ? 'PRIVATE' : 'PUBLIC';

    const slug = this.generateConnectionSlug(connection.accountEmail, connection.provider);

    // Handle slug collisions
    let finalSlug = slug;
    let suffix = 2;
    while (true) {
      const collision = await this.prisma.bookingProfile.findUnique({
        where: { userId_slug: { userId, slug: finalSlug } },
      });
      if (!collision) break;
      finalSlug = `${slug}-${suffix}`;
      suffix++;
    }

    await this.prisma.bookingProfile.create({
      data: {
        userId,
        connectionId,
        slug: finalSlug,
        name: connection.accountEmail || `${connection.provider} Calendar`,
        durations: [15, 30, 60],
        customDays: [],
        isActive: true,
        visibility,
      },
    });

    this.logger.log(`Created booking profile "${finalSlug}" for connection ${connectionId}`);
  }

  async ensureSelfCalendarGrant(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { handle: true },
    });
    if (!user?.handle) return;

    // Check if self-grant already exists
    const existing = await this.prisma.grant.findFirst({
      where: {
        grantorId: userId,
        granteeId: userId,
        widget: 'calendar',
        isActive: true,
      },
    });
    if (existing) return;

    await this.prisma.grant.create({
      data: {
        grantorId: userId,
        granteeId: userId,
        granteeHandle: user.handle.toLowerCase(),
        widget: 'calendar',
        scopes: ['free_busy', 'events:read', 'events:create'],
      },
    });
    this.logger.log(`Auto-granted calendar self-access for @${user.handle}`);
  }

  private generateConnectionSlug(email: string | null, provider: string): string {
    if (email) {
      const domain = email.split('@')[1]?.split('.')[0];
      if (domain && ['gmail', 'googlemail', 'outlook', 'hotmail', 'live', 'yahoo'].includes(domain)) {
        return 'personal';
      }
      return domain || provider.toLowerCase();
    }
    return provider.toLowerCase();
  }

  private mergeBusySlots(
    slots: Array<{ start: Date; end: Date; sourceName: string }>,
  ): Array<{ start: Date; end: Date; sourceName: string }> {
    if (slots.length === 0) return [];

    // Sort by start time
    const sorted = [...slots].sort((a, b) => a.start.getTime() - b.start.getTime());
    const merged: typeof sorted = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const last = merged[merged.length - 1];
      const current = sorted[i];

      if (current.start.getTime() <= last.end.getTime()) {
        // Overlapping - extend the end time
        if (current.end.getTime() > last.end.getTime()) {
          last.end = current.end;
        }
        // Keep source name of the longer event
        last.sourceName = 'Multiple calendars';
      } else {
        merged.push(current);
      }
    }

    return merged;
  }
}
