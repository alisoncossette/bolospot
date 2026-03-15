import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface CreateApprovalDto {
  requestorHandle?: string;
  requestorEmail?: string;
  requestorName?: string;
  agentName?: string;
  actionType: string;
  actionDetails: Record<string, any>;
  meetingTitle?: string;
  meetingDuration?: number;
  proposedTimes?: { start: string; end: string }[];
  expiresInHours?: number;
}

interface RespondToApprovalDto {
  status: 'APPROVED' | 'DENIED';
  responseNote?: string;
}

@Injectable()
export class ApprovalsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create a new approval request for a user
   */
  async createApproval(userId: string, dto: CreateApprovalDto) {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + (dto.expiresInHours || 24));

    return this.prisma.approvalRequest.create({
      data: {
        userId,
        requestorHandle: dto.requestorHandle,
        requestorEmail: dto.requestorEmail,
        requestorName: dto.requestorName,
        agentName: dto.agentName,
        actionType: dto.actionType,
        actionDetails: dto.actionDetails,
        meetingTitle: dto.meetingTitle,
        meetingDuration: dto.meetingDuration,
        proposedTimes: dto.proposedTimes || [],
        expiresAt,
      },
    });
  }

  /**
   * List all approval requests for a user
   */
  async listApprovals(userId: string, filter?: 'pending' | 'completed' | 'all') {
    const where: any = { userId };

    if (filter === 'pending') {
      where.status = 'PENDING';
      where.expiresAt = { gt: new Date() };
    } else if (filter === 'completed') {
      where.OR = [
        { status: { in: ['APPROVED', 'DENIED'] } },
        { expiresAt: { lt: new Date() } },
      ];
    }

    const approvals = await this.prisma.approvalRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // Update expired approvals
    const now = new Date();
    return approvals.map((a) => ({
      ...a,
      status: a.status === 'PENDING' && a.expiresAt < now ? 'EXPIRED' : a.status,
    }));
  }

  /**
   * Get a single approval request
   */
  async getApproval(userId: string, approvalId: string) {
    const approval = await this.prisma.approvalRequest.findFirst({
      where: { id: approvalId, userId },
    });

    if (!approval) {
      throw new NotFoundException('Approval request not found');
    }

    // Check if expired
    if (approval.status === 'PENDING' && approval.expiresAt < new Date()) {
      return { ...approval, status: 'EXPIRED' };
    }

    return approval;
  }

  /**
   * Respond to an approval request (approve or deny)
   */
  async respondToApproval(userId: string, approvalId: string, dto: RespondToApprovalDto) {
    const approval = await this.prisma.approvalRequest.findFirst({
      where: { id: approvalId, userId },
    });

    if (!approval) {
      throw new NotFoundException('Approval request not found');
    }

    if (approval.status !== 'PENDING') {
      throw new BadRequestException('This request has already been responded to');
    }

    if (approval.expiresAt < new Date()) {
      throw new BadRequestException('This request has expired');
    }

    return this.prisma.approvalRequest.update({
      where: { id: approvalId },
      data: {
        status: dto.status,
        respondedAt: new Date(),
        responseNote: dto.responseNote,
      },
    });
  }

  /**
   * Get pending approval count for a user
   */
  async getPendingCount(userId: string) {
    const count = await this.prisma.approvalRequest.count({
      where: {
        userId,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
    });

    return { count };
  }

  /**
   * Mark expired approvals (called periodically or on-demand)
   */
  async markExpiredApprovals() {
    const result = await this.prisma.approvalRequest.updateMany({
      where: {
        status: 'PENDING',
        expiresAt: { lt: new Date() },
      },
      data: {
        status: 'EXPIRED',
      },
    });

    return { updated: result.count };
  }
}
