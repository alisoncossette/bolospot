import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async listUsers(search?: string) {
    const where = search
      ? {
          OR: [
            { handle: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
            { name: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    return this.prisma.user.findMany({
      where,
      select: {
        id: true,
        handle: true,
        email: true,
        name: true,
        betaAccess: true,
        isSuperAdmin: true,
        verificationLevel: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async setBetaAccess(handle: string, betaAccess: boolean) {
    const user = await this.prisma.user.findUnique({ where: { handle } });
    if (!user) throw new NotFoundException(`User @${handle} not found`);

    return this.prisma.user.update({
      where: { handle },
      data: { betaAccess },
      select: {
        id: true,
        handle: true,
        email: true,
        name: true,
        betaAccess: true,
        isSuperAdmin: true,
      },
    });
  }

  async setBetaAccessBulk(handles: string[], betaAccess: boolean) {
    const result = await this.prisma.user.updateMany({
      where: { handle: { in: handles } },
      data: { betaAccess },
    });
    return { updated: result.count };
  }

  async getBetaCohort() {
    return this.prisma.user.findMany({
      where: { betaAccess: true },
      select: {
        id: true,
        handle: true,
        email: true,
        name: true,
        betaAccess: true,
        createdAt: true,
      },
      orderBy: { handle: 'asc' },
    });
  }
}
