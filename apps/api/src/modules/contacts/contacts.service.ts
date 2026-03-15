import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface AddTrustedContactDto {
  handle?: string;
  email?: string;
  autoApproveInvites?: boolean;
  autoShareCalendar?: boolean;
  priority?: string;
  maxDuration?: number | null;
  maxFrequency?: string | null;
  category?: string | null;
  notes?: string | null;
  customHoursStart?: number | null;
  customHoursEnd?: number | null;
  customDays?: number[];
  allowOverrideRequest?: boolean;
}

interface UpdateTrustedContactDto {
  autoApproveInvites?: boolean;
  autoShareCalendar?: boolean;
  preferredCalendarId?: string | null;
  status?: string;
  priority?: string;
  maxDuration?: number | null;
  maxFrequency?: string | null;
  category?: string | null;
  notes?: string | null;
  customHoursStart?: number | null;
  customHoursEnd?: number | null;
  customDays?: number[];
  allowOverrideRequest?: boolean;
}

const VALID_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'VIP'] as const;
const VALID_FREQUENCIES = ['UNLIMITED', 'DAILY', 'WEEKLY', 'MONTHLY'] as const;

@Injectable()
export class ContactsService {
  constructor(private prisma: PrismaService) {}

  async listTrustedContacts(userId: string) {
    const contacts = await this.prisma.approvedContact.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return contacts.map((c) => ({
      ...c,
      contactHandle: c.contactHandle ? `@${c.contactHandle}` : null,
    }));
  }

  async addTrustedContact(userId: string, dto: AddTrustedContactDto) {
    // Must provide either handle or email
    if (!dto.handle && !dto.email) {
      throw new NotFoundException('Must provide handle or email');
    }

    // Clean handle — strip @ and lowercase to match grants storage
    const cleanHandle = (dto.handle?.startsWith('@')
      ? dto.handle.slice(1)
      : dto.handle)?.toLowerCase();

    // Check if contact already exists
    const existing = await this.prisma.approvedContact.findFirst({
      where: {
        userId,
        OR: [
          cleanHandle ? { contactHandle: cleanHandle } : {},
          dto.email ? { contactEmail: dto.email } : {},
        ].filter(o => Object.keys(o).length > 0),
      },
    });

    if (existing) {
      throw new ConflictException('Contact already in trusted list');
    }

    // If handle provided, look up the user
    let contactUserId: string | null = null;
    if (cleanHandle) {
      const contactUser = await this.prisma.user.findUnique({
        where: { handle: cleanHandle },
        select: { id: true },
      });
      if (contactUser) {
        contactUserId = contactUser.id;
      }
    }

    // Validate priority if provided
    if (dto.priority && !VALID_PRIORITIES.includes(dto.priority as typeof VALID_PRIORITIES[number])) {
      throw new BadRequestException(`Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}`);
    }

    // Validate maxFrequency if provided
    if (dto.maxFrequency && !VALID_FREQUENCIES.includes(dto.maxFrequency as typeof VALID_FREQUENCIES[number])) {
      throw new BadRequestException(`Invalid frequency. Must be one of: ${VALID_FREQUENCIES.join(', ')}`);
    }

    // Validate maxDuration if provided
    if (dto.maxDuration !== undefined && dto.maxDuration !== null && dto.maxDuration < 5) {
      throw new BadRequestException('Max duration must be at least 5 minutes');
    }

    // Validate custom hours
    this.validateCustomHours(dto.customHoursStart, dto.customHoursEnd, dto.customDays);

    return this.prisma.approvedContact.create({
      data: {
        userId,
        contactHandle: cleanHandle || null,
        contactEmail: dto.email || null,
        contactUserId,
        autoApproveInvites: dto.autoApproveInvites ?? false,
        autoShareCalendar: dto.autoShareCalendar ?? false,
        status: 'APPROVED',
        approvedAt: new Date(),
        priority: dto.priority ?? 'MEDIUM',
        maxDuration: dto.maxDuration ?? null,
        maxFrequency: dto.maxFrequency ?? null,
        category: dto.category ?? null,
        notes: dto.notes ?? null,
        customHoursStart: dto.customHoursStart ?? null,
        customHoursEnd: dto.customHoursEnd ?? null,
        customDays: dto.customDays ?? [],
        allowOverrideRequest: dto.allowOverrideRequest ?? false,
      },
    });
  }

  async updateTrustedContact(userId: string, contactId: string, dto: UpdateTrustedContactDto) {
    const contact = await this.prisma.approvedContact.findFirst({
      where: { id: contactId, userId },
    });

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    // Validate priority if provided
    if (dto.priority && !VALID_PRIORITIES.includes(dto.priority as typeof VALID_PRIORITIES[number])) {
      throw new BadRequestException(`Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}`);
    }

    // Validate maxFrequency if provided
    if (dto.maxFrequency && !VALID_FREQUENCIES.includes(dto.maxFrequency as typeof VALID_FREQUENCIES[number])) {
      throw new BadRequestException(`Invalid frequency. Must be one of: ${VALID_FREQUENCIES.join(', ')}`);
    }

    // Validate maxDuration if provided
    if (dto.maxDuration !== undefined && dto.maxDuration !== null && dto.maxDuration < 5) {
      throw new BadRequestException('Max duration must be at least 5 minutes');
    }

    // Validate custom hours
    this.validateCustomHours(dto.customHoursStart, dto.customHoursEnd, dto.customDays);

    return this.prisma.approvedContact.update({
      where: { id: contactId },
      data: {
        autoApproveInvites: dto.autoApproveInvites,
        autoShareCalendar: dto.autoShareCalendar,
        preferredCalendarId: dto.preferredCalendarId,
        status: dto.status,
        priority: dto.priority,
        maxDuration: dto.maxDuration,
        maxFrequency: dto.maxFrequency,
        category: dto.category,
        notes: dto.notes,
        customHoursStart: dto.customHoursStart,
        customHoursEnd: dto.customHoursEnd,
        customDays: dto.customDays,
        allowOverrideRequest: dto.allowOverrideRequest,
      },
    });
  }

  async removeTrustedContact(userId: string, contactId: string) {
    const contact = await this.prisma.approvedContact.findFirst({
      where: { id: contactId, userId },
    });

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    return this.prisma.approvedContact.delete({
      where: { id: contactId },
    });
  }

  // Check if organizer is trusted by participant (for auto-approve and calendar routing)
  async isOrganizerTrusted(participantUserId: string, organizerUserId: string, organizerHandle: string): Promise<{
    isTrusted: boolean;
    autoApproveInvites: boolean;
    autoShareCalendar: boolean;
    preferredCalendarId: string | null;
    priority: string;
    maxDuration: number | null;
    maxFrequency: string | null;
    category: string | null;
    customHoursStart: number | null;
    customHoursEnd: number | null;
    customDays: number[];
    allowOverrideRequest: boolean;
  }> {
    const contact = await this.prisma.approvedContact.findFirst({
      where: {
        userId: participantUserId,
        status: 'APPROVED',
        OR: [
          { contactUserId: organizerUserId },
          { contactHandle: organizerHandle },
        ],
      },
    });

    return {
      isTrusted: !!contact,
      autoApproveInvites: contact?.autoApproveInvites ?? false,
      autoShareCalendar: contact?.autoShareCalendar ?? false,
      preferredCalendarId: contact?.preferredCalendarId ?? null,
      priority: contact?.priority ?? 'MEDIUM',
      maxDuration: contact?.maxDuration ?? null,
      maxFrequency: contact?.maxFrequency ?? null,
      category: contact?.category ?? null,
      customHoursStart: contact?.customHoursStart ?? null,
      customHoursEnd: contact?.customHoursEnd ?? null,
      customDays: contact?.customDays ?? [],
      allowOverrideRequest: contact?.allowOverrideRequest ?? false,
    };
  }

  // Get bookable hours for a specific contact relationship
  async getContactBookableHours(
    userId: string,
    contactUserId: string | null,
    contactHandle: string | null,
  ): Promise<{
    hoursStart: number;
    hoursEnd: number;
    days: number[];
    isCustom: boolean;
    allowOverrideRequest: boolean;
  }> {
    // Look up contact relationship
    const contact = contactUserId || contactHandle
      ? await this.prisma.approvedContact.findFirst({
          where: {
            userId,
            status: 'APPROVED',
            OR: [
              contactUserId ? { contactUserId } : {},
              contactHandle ? { contactHandle } : {},
            ].filter(o => Object.keys(o).length > 0),
          },
        })
      : null;

    // Get user defaults
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { workingHoursStart: true, workingHoursEnd: true, workingDays: true },
    });

    const defaultStart = user?.workingHoursStart ?? 9;
    const defaultEnd = user?.workingHoursEnd ?? 18;
    const defaultDays = user?.workingDays ?? [1, 2, 3, 4, 5];

    if (contact?.customHoursStart != null && contact?.customHoursEnd != null) {
      return {
        hoursStart: contact.customHoursStart,
        hoursEnd: contact.customHoursEnd,
        days: contact.customDays.length > 0 ? contact.customDays : defaultDays,
        isCustom: true,
        allowOverrideRequest: contact.allowOverrideRequest,
      };
    }

    return {
      hoursStart: defaultStart,
      hoursEnd: defaultEnd,
      days: defaultDays,
      isCustom: false,
      allowOverrideRequest: contact?.allowOverrideRequest ?? false,
    };
  }

  // Get contacts by category (for applying category-wide rules)
  async getContactsByCategory(userId: string, category: string) {
    return this.prisma.approvedContact.findMany({
      where: { userId, category },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Get all unique categories for a user
  async getCategories(userId: string): Promise<string[]> {
    const contacts = await this.prisma.approvedContact.findMany({
      where: { userId, category: { not: null } },
      select: { category: true },
      distinct: ['category'],
    });
    return contacts.map(c => c.category!).filter(Boolean);
  }

  // Check meeting constraints for a contact
  async checkMeetingConstraints(
    participantUserId: string,
    organizerUserId: string,
    organizerHandle: string,
    proposedDuration: number
  ): Promise<{
    allowed: boolean;
    reason?: string;
    maxDuration?: number;
    priority: string;
  }> {
    const trust = await this.isOrganizerTrusted(participantUserId, organizerUserId, organizerHandle);

    // Check duration limit
    if (trust.maxDuration && proposedDuration > trust.maxDuration) {
      return {
        allowed: false,
        reason: `Meeting duration exceeds limit of ${trust.maxDuration} minutes for this contact`,
        maxDuration: trust.maxDuration,
        priority: trust.priority,
      };
    }

    // Check frequency limit
    if (trust.maxFrequency && trust.maxFrequency !== 'UNLIMITED') {
      const now = new Date();
      let windowStart: Date;

      switch (trust.maxFrequency) {
        case 'DAILY':
          windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'WEEKLY':
          windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'MONTHLY':
          windowStart = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        default:
          windowStart = new Date(0);
      }

      // Count confirmed meetings where this organizer booked with this participant in the window
      const recentMeetingCount = await this.prisma.meetingRequest.count({
        where: {
          organizerId: organizerUserId,
          status: { in: ['CONFIRMED', 'PENDING'] },
          createdAt: { gte: windowStart },
          participants: {
            some: { userId: participantUserId },
          },
        },
      });

      if (recentMeetingCount > 0) {
        const frequencyLabel = trust.maxFrequency.toLowerCase();
        return {
          allowed: false,
          reason: `This contact is limited to 1 meeting per ${frequencyLabel} period. A meeting already exists in the current window.`,
          priority: trust.priority,
        };
      }
    }

    return {
      allowed: true,
      priority: trust.priority,
    };
  }

  private validateCustomHours(
    start?: number | null,
    end?: number | null,
    days?: number[],
  ) {
    // Both must be set together or both null
    const hasStart = start != null;
    const hasEnd = end != null;
    if (hasStart !== hasEnd) {
      throw new BadRequestException('customHoursStart and customHoursEnd must both be set or both be null');
    }

    if (hasStart && hasEnd) {
      if (start! < 0 || start! > 23 || end! < 0 || end! > 23) {
        throw new BadRequestException('Custom hours must be between 0 and 23');
      }
      if (start! >= end!) {
        throw new BadRequestException('customHoursStart must be less than customHoursEnd');
      }
    }

    if (days && days.length > 0) {
      if (days.some(d => d < 0 || d > 6)) {
        throw new BadRequestException('Custom days must be between 0 (Sunday) and 6 (Saturday)');
      }
    }
  }
}
