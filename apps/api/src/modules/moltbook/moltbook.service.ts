import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

export interface MoltbookAgentProfile {
  id: string;
  name: string;
  description?: string;
  karma: number;
  avatar_url?: string;
  is_claimed: boolean;
  created_at: string;
  follower_count: number;
  stats: {
    posts: number;
    comments: number;
  };
  owner?: {
    x_handle?: string;
    x_name?: string;
    x_verified?: boolean;
    x_follower_count?: number;
  };
}

interface VerifyResponse {
  success: boolean;
  valid: boolean;
  agent: MoltbookAgentProfile;
}

@Injectable()
export class MoltbookService {
  private readonly logger = new Logger(MoltbookService.name);
  private readonly appKey: string | undefined;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    this.appKey = this.config.get<string>('MOLTBOOK_APP_KEY');
  }

  /**
   * Verify a Moltbook identity token by calling Moltbook's API.
   * Returns the verified agent profile or null if invalid.
   */
  async verifyIdentityToken(token: string): Promise<MoltbookAgentProfile | null> {
    if (!this.appKey) {
      this.logger.warn('MOLTBOOK_APP_KEY not configured — cannot verify identity tokens');
      return null;
    }

    try {
      const res = await fetch('https://www.moltbook.com/api/v1/agents/verify-identity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Moltbook-App-Key': this.appKey,
        },
        body: JSON.stringify({ token }),
      });

      if (!res.ok) {
        this.logger.warn(`Moltbook verification failed: ${res.status}`);
        return null;
      }

      const data: VerifyResponse = await res.json();

      if (!data.success || !data.valid) {
        return null;
      }

      return data.agent;
    } catch (err) {
      this.logger.error('Moltbook verification request failed', err);
      return null;
    }
  }

  /**
   * Resolve a verified Moltbook agent to a Bolo user.
   * Auto-creates the user + MOLTBOOK identity if they don't exist yet.
   */
  async resolveOrCreateUser(agent: MoltbookAgentProfile) {
    // Check if we already have this Moltbook agent linked
    const existing = await this.prisma.userIdentity.findFirst({
      where: {
        identityType: { code: 'MOLTBOOK' },
        value: agent.id,
      },
      include: {
        user: {
          select: {
            id: true,
            handle: true,
            email: true,
            name: true,
            timezone: true,
            isHumanVerified: true,
          },
        },
      },
    });

    if (existing) {
      // Update karma metadata on each auth
      await this.prisma.userIdentity.update({
        where: { id: existing.id },
        data: {
          metadata: {
            karma: agent.karma,
            follower_count: agent.follower_count,
            stats: agent.stats,
            owner: agent.owner,
            last_verified: new Date().toISOString(),
          },
        },
      }).catch(() => {});

      return existing.user;
    }

    // Auto-register: create a Bolo user for this Moltbook agent
    const handle = this.sanitizeHandle(agent.name);
    const { verificationLevel, isHumanVerified } = this.karmaToTrust(agent.karma);

    const moltbookType = await this.prisma.identityType.findUnique({
      where: { code: 'MOLTBOOK' },
    });

    if (!moltbookType) {
      this.logger.error('MOLTBOOK identity type not found in database');
      return null;
    }

    const user = await this.prisma.user.create({
      data: {
        handle,
        email: `${handle}@moltbook.agent`, // Synthetic email for agent
        name: agent.name,
        verificationLevel,
        isHumanVerified,
        needsOnboarding: false,
        identities: {
          create: {
            identityTypeId: moltbookType.id,
            value: agent.id,
            displayValue: agent.name,
            isPrimary: true,
            isVerified: true,
            verifiedAt: new Date(),
            metadata: {
              karma: agent.karma,
              follower_count: agent.follower_count,
              stats: agent.stats,
              owner: agent.owner,
            },
          },
        },
      },
      select: {
        id: true,
        handle: true,
        email: true,
        name: true,
        timezone: true,
        isHumanVerified: true,
      },
    });

    this.logger.log(`Auto-registered Moltbook agent "${agent.name}" as @${handle} (karma: ${agent.karma})`);
    return user;
  }

  /**
   * Map Moltbook karma to Bolo trust tiers.
   */
  karmaToTrust(karma: number): { verificationLevel: string; isHumanVerified: boolean } {
    if (karma >= 100) {
      return { verificationLevel: 'VERIFIED', isHumanVerified: true };
    }
    if (karma >= 10) {
      return { verificationLevel: 'BASIC', isHumanVerified: false };
    }
    return { verificationLevel: 'UNVERIFIED', isHumanVerified: false };
  }

  /**
   * Sanitize a Moltbook agent name into a valid Bolo handle.
   */
  private sanitizeHandle(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .substring(0, 30) || 'moltbook-agent';
  }
}
