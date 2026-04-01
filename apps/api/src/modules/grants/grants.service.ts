import { Injectable, NotFoundException, ConflictException, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';

interface CreateGrantDto {
  granteeHandle?: string;
  granteeEmail?: string;
  widget: string;
  scopes: string[];
  note?: string;
  expiresAt?: Date;
}

interface RequestAccessDto {
  targetHandle: string;
  widget: string;
  scopes: string[];
  reason?: string;
  agentName?: string;
}

@Injectable()
export class GrantsService {
  private readonly logger = new Logger(GrantsService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  // ─── Audit trail (append-only) ──────────────────────────────────────
  // Fire-and-forget: never blocks the request path
  private audit(
    userId: string,
    action: string,
    details: Record<string, unknown>,
    status: 'SUCCESS' | 'DENIED' | 'ERROR' = 'SUCCESS',
    extra?: { agentName?: string; requestorHandle?: string; requestorEmail?: string; errorMessage?: string },
  ) {
    this.prisma.auditLog
      .create({
        data: {
          userId,
          action,
          actionDetails: details as any,
          status,
          agentName: extra?.agentName,
          requestorHandle: extra?.requestorHandle,
          requestorEmail: extra?.requestorEmail,
          errorMessage: extra?.errorMessage,
        },
      })
      .catch((err) => this.logger.error(`Audit write failed: ${err.message}`));
  }

  // ─── Identity helpers ───────────────────────────────────────────────

  /**
   * Get a user's handle by their ID. Used by controllers to avoid
   * direct Prisma access.
   */
  async getUserHandle(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { handle: true },
    });
    return user?.handle || null;
  }

  /**
   * Count pending email-based grants for a given email.
   * Public endpoint — returns count + grantor names only, no scope details.
   */
  async countPendingGrantsByEmail(email: string) {
    if (!email) return { count: 0, grantors: [] };

    const grants = await this.prisma.grant.findMany({
      where: {
        granteeEmail: { equals: email.toLowerCase().trim(), mode: 'insensitive' },
        granteeHandle: null,
        isActive: true,
        revokedAt: null,
      },
      select: {
        grantorId: true,
        grantor: { select: { name: true, handle: true } },
      },
    });

    // Deduplicate grantors (one person may have granted multiple widgets)
    const uniqueGrantors = new Map<string, { name: string | null; handle: string }>();
    for (const g of grants) {
      if (!uniqueGrantors.has(g.grantorId)) {
        uniqueGrantors.set(g.grantorId, { name: g.grantor.name, handle: g.grantor.handle });
      }
    }

    return {
      count: grants.length,
      grantors: [...uniqueGrantors.values()].map((g) => g.name || `@${g.handle}`),
    };
  }

  // ─── Permission Categories (Bolo-controlled, not a marketplace) ────

  /**
   * Get a widget by slug, or throw if not found.
   */
  private async getWidget(slug: string) {
    const widget = await this.prisma.widget.findUnique({ where: { slug } });
    if (!widget || !widget.isActive) {
      const available = await this.prisma.widget.findMany({
        where: { isActive: true },
        select: { slug: true },
      });
      throw new NotFoundException(
        `Unknown permission category "${slug}". Available: ${available.map((w) => w.slug).join(', ')}`,
      );
    }
    return widget;
  }

  /**
   * List all active permission categories.
   */
  async getWidgets() {
    const widgets = await this.prisma.widget.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });

    return widgets.map((w) => ({
      slug: w.slug,
      name: w.name,
      description: w.description,
      icon: w.icon,
      scopes: w.scopes,
    }));
  }

  /**
   * Seed Bolo's permission categories on startup.
   * These are NOT plugins — they're the types of access Bolo can proxy.
   * Data always flows: Agent → Bolo → User's services → Bolo → Agent
   */
  async seedWidgets() {
    // Only seed categories that have real proxy endpoints behind them.
    // Add new categories here ONLY when the corresponding data flow is implemented.
    const widgets = [
      {
        slug: 'calendar',
        name: 'Calendar',
        description: 'Availability, scheduling, and event access',
        icon: '📅',
        scopes: ['free_busy', 'events:read', 'events:create'],
      },
      {
        slug: 'bomed',
        name: 'BoMed',
        description: 'PT and medical appointment scheduling',
        icon: '🩺',
        scopes: ['appointments:read', 'appointments:book', 'patients:read'],
      },
      {
        slug: 'bolove',
        name: 'BoLove',
        description: 'Simulated dating via agent relay',
        icon: '💕',
        scopes: ['date:initiate', 'date:respond', 'profile:share'],
      },
      {
        slug: 'bohire',
        name: 'BoHire',
        description: 'Candidate scheduling and technical profiling',
        icon: '🧑‍💻',
        scopes: ['interviews:schedule', 'candidates:read', 'profiling:assess', 'profiling:share'],
      },
      {
        slug: 'notes',
        name: 'Notes',
        description: 'Shared notes and documents',
        icon: '📝',
        scopes: ['notes:read', 'notes:comment', 'notes:write'],
      },
      {
        slug: 'bolo_internal',
        name: 'Bolo Internal',
        description: 'Access to internal Bolo pages and resources',
        icon: '🔒',
        scopes: ['lfg', 'docs'],
      },
      {
        slug: 'relay',
        name: 'Relay',
        description: 'Agent-to-agent messaging through the trust boundary',
        icon: '📨',
        scopes: ['query:send'],
      },
      {
        slug: 'ladybug',
        name: 'Ladybug Robotics',
        description: 'AI reading robot — voice cloning and personalized reading',
        icon: '🐞',
        scopes: ['voice:use', 'voice:clone'],
      },
    ];

    // Look up the platform admin for seeded widgets
    const admin = await this.prisma.user.findUnique({
      where: { handle: 'alisonclaritrace' },
      select: { id: true },
    });
    const adminIds = admin ? [admin.id] : [];

    for (const w of widgets) {
      await this.prisma.widget.upsert({
        where: { slug: w.slug },
        update: { name: w.name, description: w.description, icon: w.icon, scopes: w.scopes, adminIds },
        create: { ...w, adminIds },
      });
    }

    this.logger.log(`Seeded ${widgets.length} permission categories (admin: ${admin ? '@alisonclaritrace' : 'not found yet'})`);
  }

  // ─── Grants ────────────────────────────────────────────────────────

  /**
   * Grant access to another @handle for a specific widget + scopes.
   * This is the core Bolo primitive.
   */
  async createGrant(grantorId: string, dto: CreateGrantDto): Promise<Record<string, unknown>> {
    if (!dto.granteeHandle && !dto.granteeEmail) {
      throw new ConflictException('Either granteeHandle or granteeEmail is required');
    }

    // Validate widget from Bolo's permission categories
    const widget = await this.getWidget(dto.widget);

    // Filter to valid scopes for this category
    const scopes = dto.scopes.filter((s) => widget.scopes.includes(s) || s === '*');
    if (scopes.length === 0) {
      throw new ConflictException(
        `No valid scopes for "${dto.widget}". Available: ${widget.scopes.join(', ')}`,
      );
    }

    // ─── Email-based grant path ──────────────────────────────────────
    if (dto.granteeEmail && !dto.granteeHandle) {
      const email = dto.granteeEmail.toLowerCase().trim();

      // Check if a user already exists with this email — upgrade to handle-based grant
      const existingUser = await this.prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { id: true, handle: true },
      });

      if (existingUser) {
        // User exists — create a normal handle-based grant
        return this.createGrant(grantorId, {
          ...dto,
          granteeHandle: existingUser.handle,
          granteeEmail: undefined,
        });
      }

      // Also check UserEmail table (secondary emails)
      const secondaryEmail = await this.prisma.userEmail.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        include: { user: { select: { id: true, handle: true } } },
      });

      if (secondaryEmail) {
        return this.createGrant(grantorId, {
          ...dto,
          granteeHandle: secondaryEmail.user.handle,
          granteeEmail: undefined,
        });
      }

      // No user found — create a pending email-based grant
      const grant = await this.prisma.grant.upsert({
        where: {
          grantorId_granteeEmail_widget: {
            grantorId,
            granteeEmail: email,
            widget: dto.widget,
          },
        },
        update: {
          scopes,
          note: dto.note,
          expiresAt: dto.expiresAt || null,
          isActive: true,
          revokedAt: null,
        },
        create: {
          grantorId,
          granteeEmail: email,
          widget: dto.widget,
          scopes,
          note: dto.note,
          expiresAt: dto.expiresAt || null,
        },
      });

      // Get grantor info for the notification email
      const grantor = await this.prisma.user.findUnique({
        where: { id: grantorId },
        select: { name: true, handle: true },
      });

      // Count total pending grants for this email
      const pendingCount = await this.prisma.grant.count({
        where: {
          granteeEmail: email,
          granteeHandle: null,
          isActive: true,
          revokedAt: null,
        },
      });

      // Send notification email (fire-and-forget)
      this.sendPendingGrantEmail(email, {
        grantorName: grantor?.name || `@${grantor?.handle}`,
        grantorHandle: grantor?.handle || 'unknown',
        pendingCount,
        widget: widget.name,
      }).catch((err) => this.logger.error(`Failed to send pending grant email: ${err.message}`));

      this.logger.log(`Email grant created: ${email} → ${dto.widget}:${scopes.join(',')}`);
      this.audit(grantorId, 'grant.create_email', {
        grantId: grant.id,
        granteeEmail: email,
        widget: dto.widget,
        scopes,
        expiresAt: dto.expiresAt || null,
      });

      return {
        id: grant.id,
        granteeEmail: email,
        granteeHandle: null,
        widget: grant.widget,
        scopes: grant.scopes,
        note: grant.note,
        expiresAt: grant.expiresAt,
        granteeRegistered: false,
        pendingInvite: true,
      };
    }

    // ─── Handle-based grant path (existing behavior) ─────────────────
    const cleanHandle = dto.granteeHandle!.startsWith('@')
      ? dto.granteeHandle!.slice(1)
      : dto.granteeHandle!;

    // Resolve grantee user ID if they exist
    const grantee = await this.prisma.user.findUnique({
      where: { handle: cleanHandle.toLowerCase() },
      select: { id: true },
    });

    // Upsert: update if grant already exists for this grantor+handle+widget
    const grant = await this.prisma.grant.upsert({
      where: {
        grantorId_granteeHandle_widget: {
          grantorId,
          granteeHandle: cleanHandle.toLowerCase(),
          widget: dto.widget,
        },
      },
      update: {
        scopes,
        note: dto.note,
        expiresAt: dto.expiresAt || null,
        granteeId: grantee?.id || null,
        isActive: true,
        revokedAt: null,
      },
      create: {
        grantorId,
        granteeHandle: cleanHandle.toLowerCase(),
        granteeId: grantee?.id || null,
        widget: dto.widget,
        scopes,
        note: dto.note,
        expiresAt: dto.expiresAt || null,
      },
    });

    this.logger.log(`Grant created: @${cleanHandle} → ${dto.widget}:${scopes.join(',')}`);
    this.audit(grantorId, 'grant.create', {
      grantId: grant.id,
      granteeHandle: cleanHandle,
      widget: dto.widget,
      scopes,
      expiresAt: dto.expiresAt || null,
    });

    return {
      id: grant.id,
      granteeHandle: `@${grant.granteeHandle}`,
      widget: grant.widget,
      scopes: grant.scopes,
      note: grant.note,
      expiresAt: grant.expiresAt,
      granteeRegistered: !!grantee,
    };
  }

  // ─── Pending grant email notification ────────────────────────────
  private async sendPendingGrantEmail(
    email: string,
    data: { grantorName: string; grantorHandle: string; pendingCount: number; widget: string },
  ) {
    const { escapeHtml } = await import('../email/email.service');
    const claimUrl = `https://bolospot.com/signup?email=${encodeURIComponent(email)}`;

    await this.emailService.sendEmail({
      to: email,
      subject: `${data.grantorName} shared ${data.widget} access with you on Bolospot`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
          <h2 style="color: #fff; margin-bottom: 8px;">You have ${data.pendingCount} bolo${data.pendingCount > 1 ? 's' : ''} waiting</h2>
          <p style="color: #aaa; margin-bottom: 24px;">
            <strong>${escapeHtml(data.grantorName)}</strong> (@${escapeHtml(data.grantorHandle)}) shared ${escapeHtml(data.widget)} access with you on Bolospot.
          </p>
          <a href="${claimUrl}" style="display: inline-block; background: #27d558; color: #000; font-weight: 600; padding: 12px 24px; border-radius: 8px; text-decoration: none;">
            Claim your @handle
          </a>
          <p style="color: #666; font-size: 12px; margin-top: 32px;">
            Bolospot is a permission layer for AI agents. Someone granted you access — sign up to activate it.
          </p>
        </div>
      `,
      text: `${data.grantorName} (@${data.grantorHandle}) shared ${data.widget} access with you on Bolospot. You have ${data.pendingCount} bolo(s) waiting. Claim your @handle: ${claimUrl}`,
    });
  }

  /**
   * Revoke a grant.
   */
  async revokeGrant(grantorId: string, grantId: string) {
    const grant = await this.prisma.grant.findFirst({
      where: { id: grantId, grantorId },
    });

    if (!grant) {
      throw new NotFoundException('Grant not found');
    }

    await this.prisma.grant.update({
      where: { id: grantId },
      data: { isActive: false, revokedAt: new Date() },
    });

    this.logger.log(`Grant revoked: ${grantId} — @${grant.granteeHandle} / ${grant.widget} by ${grantorId}`);
    this.audit(grantorId, 'grant.revoke', {
      grantId,
      granteeHandle: grant.granteeHandle,
      widget: grant.widget,
      scopes: grant.scopes,
    });

    return { success: true, revoked: `@${grant.granteeHandle} / ${grant.widget}` };
  }

  /**
   * List all grants I've given out.
   */
  async listMyGrants(userId: string) {
    const now = new Date();
    const grants = await this.prisma.grant.findMany({
      where: {
        grantorId: userId,
        isActive: true,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: 'desc' },
    });

    // Look up grantee verification info
    const handles = [...new Set(grants.map((g) => g.granteeHandle).filter((h): h is string => h !== null))];
    const granteeUsers = handles.length > 0
      ? await this.prisma.user.findMany({
          where: { handle: { in: handles } },
          select: { handle: true, isHumanVerified: true, verificationLevel: true },
        })
      : [];
    const verificationMap = new Map(
      granteeUsers.map((u) => [u.handle, { isHumanVerified: u.isHumanVerified, verificationLevel: u.verificationLevel }]),
    );

    return grants.map((g) => {
      const verification = g.granteeHandle ? verificationMap.get(g.granteeHandle) : undefined;
      return {
        id: g.id,
        granteeHandle: g.granteeHandle ? `@${g.granteeHandle}` : null,
        granteeEmail: g.granteeEmail || null,
        pendingInvite: !g.granteeHandle && !!g.granteeEmail,
        widget: g.widget,
        scopes: g.scopes,
        note: g.note,
        expiresAt: g.expiresAt,
        createdAt: g.createdAt,
        granteeVerified: verification?.isHumanVerified || false,
        granteeVerificationLevel: verification?.verificationLevel || 'BASIC',
      };
    });
  }

  /**
   * List all grants I've received.
   */
  async listGrantsToMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { handle: true },
    });

    if (!user) throw new NotFoundException('User not found');
    if (!user.handle) return [];

    const now = new Date();
    const grants = await this.prisma.grant.findMany({
      where: {
        granteeHandle: user.handle.toLowerCase(),
        isActive: true,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      include: {
        grantor: { select: { handle: true, name: true, verificationLevel: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return grants.map((g) => ({
      id: g.id,
      grantorHandle: g.grantor.handle,
      grantorName: g.grantor.name,
      verified: g.grantor.verificationLevel !== 'BASIC',
      widget: g.widget,
      scopes: g.scopes,
      note: g.note,
      expiresAt: g.expiresAt,
    }));
  }

  /**
   * THE KEY ENDPOINT: Check what @handle has shared with you.
   * Returns access map across all Bolo permission categories.
   *
   * Flow: Agent → this endpoint → scoped response
   * Agent NEVER gets raw tokens or direct service access.
   */
  async checkAccess(requestorHandle: string, targetHandle: string) {
    const cleanRequestor = requestorHandle.startsWith('@') ? requestorHandle.slice(1) : requestorHandle;
    const cleanTarget = targetHandle.startsWith('@') ? targetHandle.slice(1) : targetHandle;

    // Check if target exists
    const target = await this.prisma.user.findUnique({
      where: { handle: cleanTarget.toLowerCase() },
      select: { id: true, handle: true, name: true, verificationLevel: true, isHumanVerified: true },
    });

    if (!target) {
      return {
        handle: `@${cleanTarget}`,
        exists: false,
        message: `@${cleanTarget} is not on Bolo yet`,
        claimUrl: `https://bolospot.com/b/${cleanTarget}`,
      };
    }

    // Get all active grants from target → requestor
    const grants = await this.prisma.grant.findMany({
      where: {
        grantorId: target.id,
        granteeHandle: cleanRequestor.toLowerCase(),
        isActive: true,
        revokedAt: null,
      },
    });

    // Filter out expired grants
    const now = new Date();
    const activeGrants = grants.filter((g) => !g.expiresAt || g.expiresAt > now);

    // Build access map
    const access: Record<string, { scopes: string[]; expiresAt: Date | null }> = {};
    for (const grant of activeGrants) {
      access[grant.widget] = {
        scopes: grant.scopes,
        expiresAt: grant.expiresAt,
      };
    }

    // Get ALL Bolo permission categories and show status for each
    const allWidgets = await this.prisma.widget.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });

    const widgets = allWidgets.map((w) => ({
      widget: w.slug,
      name: w.name,
      icon: w.icon,
      status: access[w.slug] ? 'granted' as const : 'no_access' as const,
      scopes: access[w.slug]?.scopes || [],
      expiresAt: access[w.slug]?.expiresAt || null,
    }));

    // Check for pending requests
    const pendingRequests = await this.prisma.grantRequest.findMany({
      where: {
        requestorHandle: cleanRequestor.toLowerCase(),
        targetHandle: cleanTarget.toLowerCase(),
        status: 'PENDING',
      },
    });

    return {
      handle: `@${target.handle}`,
      name: target.name,
      exists: true,
      verified: target.verificationLevel !== 'BASIC',
      humanVerified: target.isHumanVerified,
      widgets,
      pendingRequests: pendingRequests.map((r) => ({
        widget: r.widget,
        scopes: r.scopes,
        requestedAt: r.createdAt,
      })),
    };
  }

  /**
   * Check if a specific scope is granted.
   * Used internally by Bolo's own endpoints (e.g., availability service).
   */
  async hasAccess(
    granteeHandle: string,
    grantorHandle: string,
    widget: string,
    scope: string,
  ): Promise<boolean> {
    const cleanGrantee = granteeHandle.startsWith('@') ? granteeHandle.slice(1) : granteeHandle;
    const cleanGrantor = grantorHandle.startsWith('@') ? grantorHandle.slice(1) : grantorHandle;

    const grantor = await this.prisma.user.findUnique({
      where: { handle: cleanGrantor.toLowerCase() },
      select: { id: true },
    });

    if (!grantor) return false;

    const grant = await this.prisma.grant.findUnique({
      where: {
        grantorId_granteeHandle_widget: {
          grantorId: grantor.id,
          granteeHandle: cleanGrantee.toLowerCase(),
          widget,
        },
      },
    });

    if (!grant || !grant.isActive || grant.revokedAt) {
      this.logger.warn(`Access denied: @${cleanGrantee} → @${cleanGrantor} ${widget}:${scope} (no active grant)`);
      if (grantor) {
        this.audit(grantor.id, 'access.denied', {
          granteeHandle: cleanGrantee, grantorHandle: cleanGrantor, widget, scope, reason: 'no_active_grant',
        }, 'DENIED', { requestorHandle: cleanGrantee });
      }
      return false;
    }
    if (grant.expiresAt && grant.expiresAt < new Date()) {
      this.logger.warn(`Access denied: @${cleanGrantee} → @${cleanGrantor} ${widget}:${scope} (grant expired)`);
      this.audit(grantor.id, 'access.denied', {
        granteeHandle: cleanGrantee, grantorHandle: cleanGrantor, widget, scope, reason: 'grant_expired', grantId: grant.id,
      }, 'DENIED', { requestorHandle: cleanGrantee });
      return false;
    }

    const allowed = grant.scopes.includes(scope) || grant.scopes.includes('*');
    if (!allowed) {
      this.logger.warn(`Access denied: @${cleanGrantee} → @${cleanGrantor} ${widget}:${scope} (scope not in grant: ${grant.scopes.join(',')})`);
      this.audit(grantor.id, 'access.denied', {
        granteeHandle: cleanGrantee, grantorHandle: cleanGrantor, widget, scope, reason: 'scope_not_granted', grantId: grant.id,
      }, 'DENIED', { requestorHandle: cleanGrantee });
    }
    return allowed;
  }

  /**
   * Request access to someone's permission category.
   * Creates a pending request that the target can approve/decline.
   */
  async requestAccess(requestorId: string | null, dto: RequestAccessDto) {
    const cleanTarget = dto.targetHandle.startsWith('@')
      ? dto.targetHandle.slice(1)
      : dto.targetHandle;

    // Validate widget exists in Bolo's categories
    await this.getWidget(dto.widget);

    const target = await this.prisma.user.findUnique({
      where: { handle: cleanTarget.toLowerCase() },
      select: { id: true, handle: true },
    });

    if (!target) {
      return {
        success: false,
        message: `@${cleanTarget} is not on Bolo yet`,
        claimUrl: `https://bolospot.com/b/${cleanTarget}`,
      };
    }

    // Get requestor handle
    let requestorHandle = dto.agentName || 'anonymous';
    if (requestorId) {
      const requestor = await this.prisma.user.findUnique({
        where: { id: requestorId },
        select: { handle: true },
      });
      if (requestor) requestorHandle = requestor.handle;
    }

    const rHandle = requestorHandle.toLowerCase();
    const tHandle = target.handle.toLowerCase();

    // ─── Self-grant: auto-approve immediately ─────────────────────────
    // If the requestor IS the target, skip the approval flow entirely
    // and create an active grant directly. No one should have to approve
    // their own request to themselves.
    if (rHandle === tHandle || (requestorId && requestorId === target.id)) {
      const grant = await this.createGrant(target.id, {
        granteeHandle: rHandle,
        widget: dto.widget,
        scopes: dto.scopes,
        note: dto.reason,
      });

      this.logger.log(`Self-grant auto-approved: @${rHandle} ${dto.widget}:${dto.scopes.join(',')}`);
      this.audit(target.id, 'grant.self_approve', {
        widget: dto.widget, scopes: dto.scopes, grantId: grant.id,
      });

      return {
        success: true,
        requestId: grant.id,
        message: `Self-grant auto-approved for @${target.handle}`,
        widget: dto.widget,
        scopes: dto.scopes,
        autoApproved: true,
      };
    }

    // ─── Anti-spam: duplicate check ────────────────────────────────────
    // Block if there's already a PENDING request for the same requestor+target+widget
    const existingPending = await this.prisma.grantRequest.findFirst({
      where: {
        requestorHandle: rHandle,
        targetHandle: tHandle,
        widget: dto.widget,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
    });

    if (existingPending) {
      return {
        success: false,
        message: `You already have a pending request for @${target.handle} calendar. Wait for a response.`,
        existingRequestId: existingPending.id,
      };
    }

    // ─── Anti-spam: decline cooldown ───────────────────────────────────
    // If target declined the same request recently, enforce a 7-day cooldown
    const recentDecline = await this.prisma.grantRequest.findFirst({
      where: {
        requestorHandle: rHandle,
        targetHandle: tHandle,
        widget: dto.widget,
        status: 'DECLINED',
        respondedAt: { gt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { respondedAt: 'desc' },
    });

    if (recentDecline) {
      const retryAfter = new Date(recentDecline.respondedAt!.getTime() + 7 * 24 * 60 * 60 * 1000);
      this.logger.warn(`Spam blocked: @${rHandle} → @${tHandle} ${dto.widget} (declined cooldown)`);
      return {
        success: false,
        message: `@${target.handle} declined this request. You can try again after ${retryAfter.toISOString().split('T')[0]}.`,
      };
    }

    // ─── Anti-spam: per-requestor rate limit ───────────────────────────
    // Max 10 requests per hour across all targets (prevents spray attacks)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentRequestCount = await this.prisma.grantRequest.count({
      where: {
        requestorHandle: rHandle,
        createdAt: { gt: oneHourAgo },
      },
    });

    if (recentRequestCount >= 10) {
      this.logger.warn(`Spam blocked: @${rHandle} rate limit exceeded (${recentRequestCount} requests/hour)`);
      throw new HttpException(
        'Too many access requests. Max 10 per hour. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // ─── Anti-spam: per-target inbox limit ─────────────────────────────
    // Max 50 pending requests per user (prevents inbox flooding)
    const pendingForTarget = await this.prisma.grantRequest.count({
      where: {
        targetId: target.id,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
    });

    if (pendingForTarget >= 50) {
      this.logger.warn(`Spam blocked: @${tHandle} inbox full (${pendingForTarget} pending requests)`);
      return {
        success: false,
        message: `@${target.handle} has too many pending requests. Try again later.`,
      };
    }

    const request = await this.prisma.grantRequest.create({
      data: {
        requestorHandle: rHandle,
        requestorId,
        targetHandle: tHandle,
        targetId: target.id,
        widget: dto.widget,
        scopes: dto.scopes,
        reason: dto.reason,
        agentName: dto.agentName,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    this.logger.log(`Access request: @${rHandle} → @${tHandle} ${dto.widget}:${dto.scopes.join(',')} (agent: ${dto.agentName || 'none'})`);
    this.audit(target.id, 'access.request', {
      requestId: request.id, requestorHandle: rHandle, targetHandle: tHandle,
      widget: dto.widget, scopes: dto.scopes,
    }, 'SUCCESS', { agentName: dto.agentName, requestorHandle: rHandle });

    return {
      success: true,
      requestId: request.id,
      message: `Access request sent to @${target.handle}`,
      widget: dto.widget,
      scopes: dto.scopes,
    };
  }

  /**
   * List pending requests targeting me.
   */
  async listMyRequests(userId: string) {
    return this.prisma.grantRequest.findMany({
      where: { targetId: userId, status: 'PENDING', expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Approve or decline a request.
   */
  async respondToRequest(userId: string, requestId: string, approve: boolean) {
    const request = await this.prisma.grantRequest.findFirst({
      where: { id: requestId, targetId: userId, status: 'PENDING' },
    });

    if (!request) throw new NotFoundException('Request not found');

    await this.prisma.grantRequest.update({
      where: { id: requestId },
      data: { status: approve ? 'APPROVED' : 'DECLINED', respondedAt: new Date() },
    });

    if (approve) {
      await this.createGrant(userId, {
        granteeHandle: request.requestorHandle,
        widget: request.widget,
        scopes: request.scopes,
      });
    }

    this.logger.log(`Request ${approve ? 'APPROVED' : 'DECLINED'}: ${requestId} — @${request.requestorHandle} ${request.widget}:${request.scopes.join(',')}`);
    this.audit(userId, approve ? 'request.approve' : 'request.decline', {
      requestId, requestorHandle: request.requestorHandle,
      widget: request.widget, scopes: request.scopes,
    }, 'SUCCESS', { requestorHandle: request.requestorHandle });

    return {
      success: true,
      status: approve ? 'APPROVED' : 'DECLINED',
      granteeHandle: `@${request.requestorHandle}`,
      widget: request.widget,
    };
  }

  // ─── Doorstep: Tier Management ──────────────────────────────────────

  /**
   * Set the booking tier for a contact. Handles both Grant + ApprovedContact
   * in a single transaction so the two layers stay in sync.
   *
   * Accepts handle OR email — permissions can be set before the person has a Bolo account.
   */
  async setBookingTier(
    hostUserId: string,
    contactHandle?: string,
    contactEmail?: string,
    tier: 'direct' | 'approval' | 'blocked' = 'approval',
  ) {
    if (!contactHandle && !contactEmail) {
      throw new ConflictException('Must provide contactHandle or contactEmail');
    }

    const cleanHandle = contactHandle
      ? (contactHandle.startsWith('@') ? contactHandle.slice(1) : contactHandle).toLowerCase()
      : undefined;

    const cleanEmail = contactEmail?.toLowerCase();

    // Resolve contact's user ID if they're on Bolo
    let contactUserId: string | null = null;
    if (cleanHandle) {
      const user = await this.prisma.user.findUnique({
        where: { handle: cleanHandle },
        select: { id: true },
      });
      contactUserId = user?.id || null;
    } else if (cleanEmail) {
      const user = await this.prisma.user.findFirst({
        where: { email: cleanEmail },
        select: { id: true, handle: true },
      });
      contactUserId = user?.id || null;
    }

    await this.prisma.$transaction(async (tx) => {
      if (tier === 'blocked') {
        // Revoke any active calendar grant
        if (cleanHandle) {
          await tx.grant.updateMany({
            where: {
              grantorId: hostUserId,
              granteeHandle: cleanHandle,
              widget: 'calendar',
              isActive: true,
            },
            data: { isActive: false, revokedAt: new Date() },
          });
        }

        // Set contact to BLOCKED
        await this.upsertContact(tx, hostUserId, cleanHandle, cleanEmail, contactUserId, {
          status: 'BLOCKED',
          autoApproveInvites: false,
        });
      } else {
        // For direct and approval: ensure calendar grant with events:create
        if (cleanHandle) {
          await tx.grant.upsert({
            where: {
              grantorId_granteeHandle_widget: {
                grantorId: hostUserId,
                granteeHandle: cleanHandle,
                widget: 'calendar',
              },
            },
            update: {
              scopes: ['free_busy', 'events:create'],
              isActive: true,
              revokedAt: null,
              granteeId: contactUserId,
            },
            create: {
              grantorId: hostUserId,
              granteeHandle: cleanHandle,
              granteeId: contactUserId,
              widget: 'calendar',
              scopes: ['free_busy', 'events:create'],
            },
          });
        }

        // Set contact with appropriate autoApproveInvites
        await this.upsertContact(tx, hostUserId, cleanHandle, cleanEmail, contactUserId, {
          status: 'APPROVED',
          autoApproveInvites: tier === 'direct',
        });
      }
    });

    this.logger.log(`Tier set: ${cleanHandle || cleanEmail} → ${tier} by ${hostUserId}`);

    return {
      success: true,
      tier,
      contact: cleanHandle ? `@${cleanHandle}` : cleanEmail,
    };
  }

  /**
   * Upsert an ApprovedContact record within a transaction.
   */
  private async upsertContact(
    tx: any,
    userId: string,
    handle?: string,
    email?: string,
    contactUserId?: string | null,
    data: { status?: string; autoApproveInvites?: boolean } = {},
  ) {
    // Find existing by handle or email
    const existing = await tx.approvedContact.findFirst({
      where: {
        userId,
        OR: [
          ...(handle ? [{ contactHandle: handle }] : []),
          ...(email ? [{ contactEmail: email }] : []),
        ],
      },
    });

    if (existing) {
      await tx.approvedContact.update({
        where: { id: existing.id },
        data: {
          ...data,
          ...(handle && !existing.contactHandle ? { contactHandle: handle } : {}),
          ...(email && !existing.contactEmail ? { contactEmail: email } : {}),
          ...(contactUserId && !existing.contactUserId ? { contactUserId } : {}),
        },
      });
    } else {
      await tx.approvedContact.create({
        data: {
          userId,
          contactHandle: handle || null,
          contactEmail: email || null,
          contactUserId: contactUserId || null,
          status: data.status || 'APPROVED',
          autoApproveInvites: data.autoApproveInvites || false,
          priority: 'MEDIUM',
        },
      });
    }
  }

  /**
   * List all contacts with their resolved booking tier.
   * Merges grants + contacts server-side for the owner management UI.
   */
  async listContactsWithTiers(hostUserId: string): Promise<Array<{
    handle: string | null;
    email: string | null;
    name: string | null;
    tier: 'direct' | 'approval' | 'blocked';
    category: string | null;
  }>> {
    const now = new Date();

    // Batch fetch grants and contacts
    const [grants, contacts] = await Promise.all([
      this.prisma.grant.findMany({
        where: {
          grantorId: hostUserId,
          widget: 'calendar',
          isActive: true,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      }),
      this.prisma.approvedContact.findMany({
        where: { userId: hostUserId },
      }),
    ]);

    // Merge by handle or email
    const contactMap = new Map<string, {
      handle: string | null;
      email: string | null;
      hasCreateGrant: boolean;
      autoApproveInvites: boolean;
      status: string;
      category: string | null;
    }>();

    for (const c of contacts) {
      const key = c.contactHandle || c.contactEmail || c.id;
      contactMap.set(key, {
        handle: c.contactHandle ? `@${c.contactHandle}` : null,
        email: c.contactEmail,
        hasCreateGrant: false,
        autoApproveInvites: c.autoApproveInvites,
        status: c.status,
        category: c.category,
      });
    }

    for (const g of grants) {
      const key = g.granteeHandle || g.granteeEmail;
      if (!key) continue; // Skip grants with neither handle nor email
      const existing = contactMap.get(key);
      if (existing) {
        existing.hasCreateGrant = g.scopes.includes('events:create');
      } else {
        contactMap.set(key, {
          handle: g.granteeHandle ? `@${g.granteeHandle}` : null,
          email: g.granteeEmail || null,
          hasCreateGrant: g.scopes.includes('events:create'),
          autoApproveInvites: false,
          status: 'APPROVED',
          category: null,
        });
      }
    }

    // Batch fetch display names
    const handles = [...contactMap.values()]
      .map(c => c.handle?.slice(1))
      .filter(Boolean) as string[];

    const users = handles.length > 0
      ? await this.prisma.user.findMany({
          where: { handle: { in: handles } },
          select: { handle: true, name: true },
        })
      : [];

    const nameMap = new Map(users.map(u => [u.handle, u.name]));

    // Resolve tiers and build result
    const results = [...contactMap.values()].map(c => {
      let tier: 'direct' | 'approval' | 'blocked';
      if (c.status === 'BLOCKED') {
        tier = 'blocked';
      } else if (c.hasCreateGrant && c.autoApproveInvites) {
        tier = 'direct';
      } else {
        tier = 'approval';
      }

      const handleClean = c.handle?.slice(1);

      return {
        handle: c.handle,
        email: c.email,
        name: handleClean ? nameMap.get(handleClean) || null : null,
        tier,
        category: c.category,
      };
    });

    // Sort: direct first, then approval, then blocked
    const tierOrder = { direct: 0, approval: 1, blocked: 2 };
    results.sort((a, b) => {
      const orderDiff = tierOrder[a.tier] - tierOrder[b.tier];
      if (orderDiff !== 0) return orderDiff;
      const aLabel = a.name || a.handle || a.email || '';
      const bLabel = b.name || b.handle || b.email || '';
      return aLabel.localeCompare(bLabel);
    });

    return results;
  }

  /**
   * Set the default booking tier for unknown/anonymous visitors.
   */
  async setDefaultBookingTier(userId: string, autoApprove: boolean) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { autoApproveMeetings: autoApprove },
    });
    this.logger.log(`Default tier set: ${autoApprove ? 'direct' : 'approval'} by ${userId}`);
  }

  /**
   * Determine what booking tier a visitor gets for a given host.
   * This is THE doorstep function — it maps visitor identity to booking behavior.
   *
   * Resolution order:
   * 1. Per-handle Grant + ApprovedContact check
   * 2. Fall back to host's defaults based on visitor verification tier
   * 3. Anonymous visitors get 'direct' (backward compatibility)
   */
  async resolveBookingAccess(
    hostHandle: string,
    visitorHandle: string | null,
  ): Promise<{
    tier: 'direct' | 'approval' | 'blocked';
    reason: string;
  }> {
    const cleanHost = (hostHandle.startsWith('@') ? hostHandle.slice(1) : hostHandle).toLowerCase();

    const host = await this.prisma.user.findUnique({
      where: { handle: cleanHost },
      select: { id: true, handle: true, autoApproveMeetings: true },
    });

    if (!host) {
      return { tier: 'blocked', reason: 'host_not_found' };
    }

    // Anonymous visitor — check host's default tier preference
    if (!visitorHandle) {
      if (host.autoApproveMeetings === false) {
        return { tier: 'approval', reason: 'default_anonymous' };
      }
      return { tier: 'direct', reason: 'anonymous' };
    }

    const cleanVisitor = (visitorHandle.startsWith('@') ? visitorHandle.slice(1) : visitorHandle).toLowerCase();

    // Don't make someone request approval to book themselves
    if (cleanVisitor === cleanHost) {
      return { tier: 'direct', reason: 'self' };
    }

    // Check for explicit block (by handle or email)
    const visitor = await this.prisma.user.findUnique({
      where: { handle: cleanVisitor },
      select: { id: true, email: true, verificationLevel: true, isHumanVerified: true },
    });

    const blockedContact = await this.prisma.approvedContact.findFirst({
      where: {
        userId: host.id,
        status: 'BLOCKED',
        OR: [
          { contactHandle: cleanVisitor },
          ...(visitor?.email ? [{ contactEmail: visitor.email }] : []),
        ],
      },
      select: { id: true },
    });

    if (blockedContact) {
      return { tier: 'blocked', reason: 'contact_blocked' };
    }

    // Check for explicit grant: events:create scope
    const hasCreate = await this.hasAccess(cleanVisitor, cleanHost, 'calendar', 'events:create');

    if (hasCreate) {
      // Check if host has marked this contact for auto-approve (by handle or email)
      const contact = await this.prisma.approvedContact.findFirst({
        where: {
          userId: host.id,
          OR: [
            { contactHandle: cleanVisitor },
            ...(visitor?.email ? [{ contactEmail: visitor.email }] : []),
          ],
        },
        select: { autoApproveInvites: true },
      });

      if (contact?.autoApproveInvites) {
        return { tier: 'direct', reason: 'grant_direct' };
      }
      return { tier: 'approval', reason: 'grant_approval' };
    }

    // Check for free_busy scope (can see availability but not book directly)
    const hasFreeBusy = await this.hasAccess(cleanVisitor, cleanHost, 'calendar', 'free_busy');
    if (hasFreeBusy) {
      return { tier: 'approval', reason: 'grant_free_busy' };
    }

    // Check for email-based contact (permissions set before person had a Bolo account)
    if (visitor?.email) {
      const emailContact = await this.prisma.approvedContact.findFirst({
        where: {
          userId: host.id,
          contactEmail: visitor.email,
          status: { not: 'BLOCKED' },
        },
        select: { autoApproveInvites: true },
      });

      if (emailContact) {
        // Email-matched contact exists — check if there's a grant by email too
        // For now, email contacts without grants get approval tier
        return { tier: 'approval', reason: 'email_contact' };
      }
    }

    if (!visitor) {
      // Handle exists in JWT but user not found (shouldn't happen, but be safe)
      return { tier: 'approval', reason: 'default_unknown' };
    }

    const isVerified = visitor.verificationLevel !== 'BASIC';

    // Defaults matching the grants UI "Defaults" tab:
    // Trusted handles → Direct booking (handled above via ApprovedContact + grant)
    // Verified handles → Requires approval
    // Any handle → Requires approval
    if (isVerified) {
      return { tier: 'approval', reason: 'default_verified' };
    }

    return { tier: 'approval', reason: 'default_any_handle' };
  }
}
