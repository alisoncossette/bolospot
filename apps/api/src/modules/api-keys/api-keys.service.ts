import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { createHash, randomBytes } from 'crypto';

interface CreateApiKeyDto {
  name: string;
  permissions: string[];
  keyType?: 'personal' | 'widget';
  widgetSlug?: string;
}

@Injectable()
export class ApiKeysService {
  constructor(private prisma: PrismaService) {}

  /**
   * Generate a new API key for a user.
   * Returns the full key (only shown once) and the created record.
   */
  async createApiKey(userId: string, dto: CreateApiKeyDto) {
    const keyType = dto.keyType || 'personal';
    const prefix = keyType === 'widget' ? 'bolo_widget_' : 'bolo_live_';

    const randomPart = randomBytes(24).toString('base64url');
    const fullKey = `${prefix}${randomPart}`;
    const keyPrefix = fullKey.substring(0, prefix.length + 6);
    const keyHash = this.hashKey(fullKey);

    const apiKey = await this.prisma.apiKey.create({
      data: {
        userId,
        name: dto.name,
        keyHash,
        keyPrefix,
        keyType,
        widgetSlug: dto.widgetSlug || null,
        permissions: dto.permissions,
      },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        permissions: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });

    // Return the full key only once - user must save it
    return {
      ...apiKey,
      key: fullKey, // Only returned on creation
    };
  }

  /**
   * List all API keys for a user (without the actual key values).
   */
  async listApiKeys(userId: string) {
    return this.prisma.apiKey.findMany({
      where: { userId, isActive: true, revokedAt: null },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        permissions: true,
        lastUsedAt: true,
        usageCount: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Delete (revoke) an API key.
   */
  async deleteApiKey(userId: string, keyId: string) {
    const apiKey = await this.prisma.apiKey.findFirst({
      where: { id: keyId, userId },
    });

    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }

    await this.prisma.apiKey.update({
      where: { id: keyId },
      data: {
        isActive: false,
        revokedAt: new Date(),
      },
    });

    return { success: true };
  }

  /**
   * Validate an API key and return the associated user.
   * Updates usage tracking.
   */
  async validateApiKey(key: string) {
    const keyHash = this.hashKey(key);

    const apiKey = await this.prisma.apiKey.findUnique({
      where: { keyHash },
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

    if (!apiKey) {
      return null;
    }

    // Check if key is active and not expired
    if (!apiKey.isActive || apiKey.revokedAt) {
      return null;
    }

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      return null;
    }

    // Update usage tracking (fire and forget)
    this.prisma.apiKey
      .update({
        where: { id: apiKey.id },
        data: {
          lastUsedAt: new Date(),
          usageCount: { increment: 1 },
        },
      })
      .catch(() => {
        // Ignore errors on usage tracking
      });

    return {
      apiKey: {
        id: apiKey.id,
        permissions: apiKey.permissions,
        keyType: apiKey.keyType,
        widgetSlug: apiKey.widgetSlug,
      },
      user: apiKey.user,
    };
  }

  /**
   * Check if an API key has a specific permission.
   */
  hasPermission(permissions: string[], required: string): boolean {
    return permissions.includes(required) || permissions.includes('*');
  }

  private hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }
}