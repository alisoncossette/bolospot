import { Injectable, ConflictException, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class WidgetsService {
  private readonly logger = new Logger(WidgetsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Register a new widget (permission category) for a third-party app.
   * The app must have a Bolo handle and authenticate via API key.
   */
  async registerWidget(appUserId: string, dto: {
    slug: string;
    name: string;
    description?: string;
    icon?: string;
    scopes: string[];
    callbackUrl?: string;
    tosUrl?: string;
  }) {
    // Validate slug format: lowercase, alphanumeric + underscores
    if (!/^[a-z][a-z0-9_]{1,30}$/.test(dto.slug)) {
      throw new ConflictException(
        'Widget slug must be 2-31 chars, lowercase alphanumeric + underscores, start with a letter',
      );
    }

    // Check for reserved slugs (built-in widgets)
    const reserved = ['calendar', 'notes', 'relay', 'bolo_internal'];
    if (reserved.includes(dto.slug)) {
      throw new ConflictException(`Widget slug "${dto.slug}" is reserved`);
    }

    // Check if slug is already taken
    const existing = await this.prisma.widget.findUnique({
      where: { slug: dto.slug },
    });
    if (existing) {
      throw new ConflictException(`Widget slug "${dto.slug}" is already registered`);
    }

    // Validate scopes format
    if (!dto.scopes.length) {
      throw new ConflictException('At least one scope is required');
    }
    for (const scope of dto.scopes) {
      if (!/^[a-z][a-z0-9_:]{0,50}$/.test(scope)) {
        throw new ConflictException(`Invalid scope format: "${scope}"`);
      }
    }

    const widget = await this.prisma.widget.create({
      data: {
        slug: dto.slug,
        name: dto.name,
        description: dto.description,
        icon: dto.icon,
        scopes: dto.scopes,
        tosUrl: dto.tosUrl,
        registeredById: appUserId,
      },
    });

    this.logger.log(`Widget "${dto.slug}" registered by user ${appUserId}`);
    return widget;
  }

  /**
   * List all active widgets (built-in + registered).
   */
  async listWidgets() {
    return this.prisma.widget.findMany({
      where: { isActive: true },
      select: {
        slug: true,
        name: true,
        description: true,
        icon: true,
        scopes: true,
        tosUrl: true,
        registeredById: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Update a registered widget (only the app that registered it can update).
   */
  async updateWidget(appUserId: string, slug: string, dto: {
    name?: string;
    description?: string;
    icon?: string;
    scopes?: string[];
    tosUrl?: string;
  }) {
    const widget = await this.prisma.widget.findUnique({ where: { slug } });
    if (!widget) throw new NotFoundException(`Widget "${slug}" not found`);
    const isOwner = widget.registeredById === appUserId;
    const isAdmin = widget.adminIds?.includes(appUserId);
    if (!isOwner && !isAdmin) throw new ForbiddenException('Only the registering app or a widget admin can modify this widget');

    if (dto.scopes) {
      for (const scope of dto.scopes) {
        if (!/^[a-z][a-z0-9_:]{0,50}$/.test(scope)) {
          throw new ConflictException(`Invalid scope format: "${scope}"`);
        }
      }
    }

    return this.prisma.widget.update({
      where: { slug },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.icon !== undefined && { icon: dto.icon }),
        ...(dto.scopes && { scopes: dto.scopes }),
        ...(dto.tosUrl !== undefined && { tosUrl: dto.tosUrl }),
      },
    });
  }

  /**
   * Deactivate a registered widget.
   */
  async deactivateWidget(appUserId: string, slug: string) {
    const widget = await this.prisma.widget.findUnique({ where: { slug } });
    if (!widget) throw new NotFoundException(`Widget "${slug}" not found`);
    const isOwner = widget.registeredById === appUserId;
    const isAdmin = widget.adminIds?.includes(appUserId);
    if (!isOwner && !isAdmin) throw new ForbiddenException('Only the registering app or a widget admin can deactivate this widget');

    return this.prisma.widget.update({
      where: { slug },
      data: { isActive: false },
    });
  }
}
