import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        calendarConnections: {
          where: { isEnabled: true },
          select: {
            id: true,
            provider: true,
            isPrimary: true,
            lastSyncedAt: true,
            syncStatus: true,
          },
        },
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async findByHandle(handle: string) {
    // Remove @ prefix if present
    const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle;

    // First, check User.handle directly
    let user = await this.prisma.user.findFirst({
      where: { handle: { equals: cleanHandle, mode: 'insensitive' } },
      select: {
        id: true,
        handle: true,
        name: true,
        verificationLevel: true,
        isHumanVerified: true,
        handleVisibility: true,
      },
    });

    // If not found, check UserIdentity for BOLO_HANDLE
    if (!user) {
      const identity = await (this.prisma as any).userIdentity.findFirst({
        where: {
          value: { equals: cleanHandle, mode: 'insensitive' },
          identityType: { code: 'BOLO_HANDLE' },
        },
        include: {
          user: {
            select: {
              id: true,
              handle: true,
              name: true,
              verificationLevel: true,
              isHumanVerified: true,
              handleVisibility: true,
            },
          },
        },
      });
      if (identity?.user) {
        user = identity.user;
      }
    }

    if (!user) {
      throw new NotFoundException('Handle not found');
    }
    return user;
  }

  async findByEmail(email: string) {
    // Check primary email
    const user = await this.prisma.user.findUnique({
      where: { email },
    });
    if (user) return user;

    // Check secondary emails
    const userEmail = await this.prisma.userEmail.findUnique({
      where: { email },
      include: { user: true },
    });
    return userEmail?.user || null;
  }

  async search(query: string, excludeUserId?: string) {
    const q = query.trim().toLowerCase().replace(/^@/, '');
    if (q.length < 2) return [];

    // Check if query looks like an email
    const isEmail = q.includes('@');

    if (isEmail) {
      const user = await this.findByEmail(q);
      if (user && user.id !== excludeUserId) {
        return [{
          id: user.id,
          handle: user.handle,
          name: user.name,
          verificationLevel: user.verificationLevel,
        }];
      }
      return [];
    }

    // Search by handle (prefix match)
    const users = await this.prisma.user.findMany({
      where: {
        handle: { contains: q, mode: 'insensitive' },
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      },
      select: {
        id: true,
        handle: true,
        name: true,
        verificationLevel: true,
      },
      take: 20,
      orderBy: { handle: 'asc' },
    });

    return users;
  }

  async updateProfile(userId: string, data: {
    name?: string;
    timezone?: string;
    workingHoursStart?: number;
    workingHoursEnd?: number;
    workingDays?: number[];
    bufferMinutes?: number;
    aiTools?: string[];
    recordingPref?: string;
    busyBlockSyncMinutes?: number;
    busyBlockTitle?: string;
    defaultAccessAny?: string;
    defaultAccessVerified?: string;
    defaultAccessTrusted?: string;
  }) {
    return this.prisma.user.update({
      where: { id: userId },
      data,
    });
  }

  async checkHandleAvailability(handle: string) {
    const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle;

    // Check User.handle directly
    const existing = await this.prisma.user.findFirst({
      where: { handle: { equals: cleanHandle, mode: 'insensitive' } },
    });
    if (existing) {
      return { available: false };
    }

    // Also check UserIdentity for BOLO_HANDLE
    const identity = await (this.prisma as any).userIdentity.findFirst({
      where: {
        value: { equals: cleanHandle, mode: 'insensitive' },
        identityType: { code: 'BOLO_HANDLE' },
      },
    });

    return { available: !identity };
  }

  async deleteAccount(userId: string) {
    // Verify user exists
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, handle: true, email: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Delete user - cascades will handle related data
    // (calendarConnections, meetingRequests, participants, apiKeys, etc.)
    await this.prisma.user.delete({
      where: { id: userId },
    });

    return {
      success: true,
      message: `Account @${user.handle} has been permanently deleted`,
      deletedHandle: user.handle,
    };
  }

  async getRecentActivity(userId: string, limit = 10) {
    const activities: Array<{
      id: string;
      type: string;
      title: string;
      description: string;
      timestamp: Date;
      metadata?: Record<string, unknown>;
    }> = [];

    // Get recent meetings created by user
    const recentMeetings = await this.prisma.meetingRequest.findMany({
      where: { organizerId: userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        confirmedStartTime: true,
        participants: {
          select: { email: true, name: true },
        },
      },
    });

    for (const meeting of recentMeetings) {
      activities.push({
        id: `meeting-${meeting.id}`,
        type: 'MEETING_CREATED',
        title: `Created "${meeting.title}"`,
        description: `Meeting with ${meeting.participants.length} participant(s)`,
        timestamp: meeting.createdAt,
        metadata: { meetingId: meeting.id, status: meeting.status },
      });

      if (meeting.status === 'CONFIRMED' && meeting.confirmedStartTime) {
        activities.push({
          id: `meeting-confirmed-${meeting.id}`,
          type: 'MEETING_CONFIRMED',
          title: `"${meeting.title}" confirmed`,
          description: `Scheduled for ${meeting.confirmedStartTime.toLocaleDateString()}`,
          timestamp: meeting.confirmedStartTime,
          metadata: { meetingId: meeting.id },
        });
      }
    }

    // Get recent calendar connections
    const recentConnections = await this.prisma.calendarConnection.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: {
        id: true,
        provider: true,
        accountEmail: true,
        createdAt: true,
      },
    });

    for (const connection of recentConnections) {
      activities.push({
        id: `connection-${connection.id}`,
        type: 'CALENDAR_CONNECTED',
        title: `Connected ${connection.provider} Calendar`,
        description: connection.accountEmail || 'Calendar connected',
        timestamp: connection.createdAt,
        metadata: { provider: connection.provider },
      });
    }

    // Get recent participant responses to user's meetings
    const recentResponses = await this.prisma.participant.findMany({
      where: {
        meetingRequest: { organizerId: userId },
        respondedAt: { not: null },
      },
      orderBy: { respondedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        email: true,
        name: true,
        responseStatus: true,
        respondedAt: true,
        user: { select: { handle: true } },
        meetingRequest: { select: { title: true } },
      },
    });

    for (const response of recentResponses) {
      const participantName = response.user?.handle
        ? `@${response.user.handle}`
        : response.name || response.email;
      activities.push({
        id: `response-${response.id}`,
        type: response.responseStatus === 'DECLINED' ? 'PARTICIPANT_DECLINED' : 'PARTICIPANT_RESPONDED',
        title: `${participantName} ${response.responseStatus === 'DECLINED' ? 'declined' : 'responded to'} "${response.meetingRequest.title}"`,
        description: response.responseStatus === 'DECLINED' ? 'Declined the invitation' : 'Submitted availability',
        timestamp: response.respondedAt!,
        metadata: { participantId: response.id, status: response.responseStatus },
      });
    }

    // Get recent verified identities
    const recentIdentities = await this.prisma.userIdentity.findMany({
      where: { userId, isVerified: true },
      orderBy: { verifiedAt: 'desc' },
      take: 3,
      include: { identityType: true },
    });

    for (const identity of recentIdentities) {
      if (identity.verifiedAt) {
        activities.push({
          id: `identity-${identity.id}`,
          type: 'IDENTITY_VERIFIED',
          title: `Verified ${identity.identityType.name}`,
          description: identity.displayValue || identity.value,
          timestamp: identity.verifiedAt,
          metadata: { identityType: identity.identityType.code },
        });
      }
    }

    // Sort by timestamp and limit
    return activities
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }
}
