import { Test, TestingModule } from '@nestjs/testing';
import { GrantsService } from '../grants.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotFoundException, ConflictException, HttpException } from '@nestjs/common';

// ─── Mock Prisma ────────────────────────────────────────────────────
const mockPrisma = {
  user: { findUnique: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
  widget: { findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn() },
  grant: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), upsert: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  grantRequest: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), count: jest.fn(), update: jest.fn() },
  auditLog: { create: jest.fn().mockResolvedValue({}) },
};

describe('GrantsService', () => {
  let service: GrantsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GrantsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<GrantsService>(GrantsService);
  });

  // ─── createGrant ────────────────────────────────────────────────────

  describe('createGrant', () => {
    const widget = { slug: 'calendar', scopes: ['free_busy', 'events:read', 'events:create'], isActive: true };

    beforeEach(() => {
      mockPrisma.widget.findUnique.mockResolvedValue(widget);
    });

    it('should create a grant with valid scopes', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'grantee-1' });
      mockPrisma.grant.upsert.mockResolvedValue({
        id: 'grant-1',
        granteeHandle: 'sarah',
        widget: 'calendar',
        scopes: ['free_busy'],
        note: null,
        expiresAt: null,
      });

      const result = await service.createGrant('grantor-1', {
        granteeHandle: '@sarah',
        widget: 'calendar',
        scopes: ['free_busy'],
      });

      expect(result.id).toBe('grant-1');
      expect(result.granteeHandle).toBe('@sarah');
      expect(result.scopes).toEqual(['free_busy']);
      expect(result.granteeRegistered).toBe(true);
    });

    it('should strip @ from handle', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.grant.upsert.mockResolvedValue({
        id: 'grant-2',
        granteeHandle: 'mike',
        widget: 'calendar',
        scopes: ['free_busy'],
        note: null,
        expiresAt: null,
      });

      const result = await service.createGrant('grantor-1', {
        granteeHandle: '@Mike',
        widget: 'calendar',
        scopes: ['free_busy'],
      });

      expect(mockPrisma.grant.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            grantorId_granteeHandle_widget: expect.objectContaining({
              granteeHandle: 'mike',
            }),
          }),
        }),
      );
      expect(result.granteeRegistered).toBe(false);
    });

    it('should filter to valid scopes only', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'grantee-1' });
      mockPrisma.grant.upsert.mockResolvedValue({
        id: 'grant-3',
        granteeHandle: 'sarah',
        widget: 'calendar',
        scopes: ['free_busy'],
        note: null,
        expiresAt: null,
      });

      await service.createGrant('grantor-1', {
        granteeHandle: 'sarah',
        widget: 'calendar',
        scopes: ['free_busy', 'invalid_scope'],
      });

      expect(mockPrisma.grant.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            scopes: ['free_busy'],
          }),
        }),
      );
    });

    it('should throw if no valid scopes remain', async () => {
      await expect(
        service.createGrant('grantor-1', {
          granteeHandle: 'sarah',
          widget: 'calendar',
          scopes: ['bogus'],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw if widget does not exist', async () => {
      mockPrisma.widget.findUnique.mockResolvedValue(null);
      mockPrisma.widget.findMany.mockResolvedValue([{ slug: 'calendar' }]);

      await expect(
        service.createGrant('grantor-1', {
          granteeHandle: 'sarah',
          widget: 'nonexistent',
          scopes: ['read'],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should write to audit log on success', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'grantee-1' });
      mockPrisma.grant.upsert.mockResolvedValue({
        id: 'grant-audit',
        granteeHandle: 'sarah',
        widget: 'calendar',
        scopes: ['free_busy'],
        note: null,
        expiresAt: null,
      });

      await service.createGrant('grantor-1', {
        granteeHandle: 'sarah',
        widget: 'calendar',
        scopes: ['free_busy'],
      });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'grantor-1',
          action: 'grant.create',
          status: 'SUCCESS',
        }),
      });
    });
  });

  // ─── revokeGrant ──────────────────────────────────────────────────

  describe('revokeGrant', () => {
    it('should revoke an existing grant', async () => {
      mockPrisma.grant.findFirst.mockResolvedValue({
        id: 'grant-1',
        grantorId: 'user-1',
        granteeHandle: 'sarah',
        widget: 'calendar',
        scopes: ['free_busy'],
      });
      mockPrisma.grant.update.mockResolvedValue({});

      const result = await service.revokeGrant('user-1', 'grant-1');

      expect(result.success).toBe(true);
      expect(mockPrisma.grant.update).toHaveBeenCalledWith({
        where: { id: 'grant-1' },
        data: { isActive: false, revokedAt: expect.any(Date) },
      });
    });

    it('should throw if grant not found', async () => {
      mockPrisma.grant.findFirst.mockResolvedValue(null);

      await expect(service.revokeGrant('user-1', 'nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should write to audit log on revoke', async () => {
      mockPrisma.grant.findFirst.mockResolvedValue({
        id: 'grant-1',
        grantorId: 'user-1',
        granteeHandle: 'sarah',
        widget: 'calendar',
        scopes: ['free_busy'],
      });
      mockPrisma.grant.update.mockResolvedValue({});

      await service.revokeGrant('user-1', 'grant-1');

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'grant.revoke',
          status: 'SUCCESS',
        }),
      });
    });
  });

  // ─── hasAccess ────────────────────────────────────────────────────

  describe('hasAccess', () => {
    it('should return true for valid active grant with matching scope', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'grantor-1' });
      mockPrisma.grant.findUnique.mockResolvedValue({
        isActive: true,
        revokedAt: null,
        expiresAt: null,
        scopes: ['free_busy', 'events:read'],
      });

      const result = await service.hasAccess('sarah', 'tom', 'calendar', 'free_busy');
      expect(result).toBe(true);
    });

    it('should return true for wildcard scope', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'grantor-1' });
      mockPrisma.grant.findUnique.mockResolvedValue({
        isActive: true,
        revokedAt: null,
        expiresAt: null,
        scopes: ['*'],
      });

      const result = await service.hasAccess('sarah', 'tom', 'calendar', 'events:read');
      expect(result).toBe(true);
    });

    it('should return false when no grant exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'grantor-1' });
      mockPrisma.grant.findUnique.mockResolvedValue(null);

      const result = await service.hasAccess('sarah', 'tom', 'calendar', 'free_busy');
      expect(result).toBe(false);
    });

    it('should return false when grant is revoked', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'grantor-1' });
      mockPrisma.grant.findUnique.mockResolvedValue({
        isActive: false,
        revokedAt: new Date(),
        expiresAt: null,
        scopes: ['free_busy'],
      });

      const result = await service.hasAccess('sarah', 'tom', 'calendar', 'free_busy');
      expect(result).toBe(false);
    });

    it('should return false when grant is expired', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'grantor-1' });
      mockPrisma.grant.findUnique.mockResolvedValue({
        id: 'grant-expired',
        isActive: true,
        revokedAt: null,
        expiresAt: new Date(Date.now() - 86400000), // yesterday
        scopes: ['free_busy'],
      });

      const result = await service.hasAccess('sarah', 'tom', 'calendar', 'free_busy');
      expect(result).toBe(false);
    });

    it('should return false when scope not in grant', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'grantor-1' });
      mockPrisma.grant.findUnique.mockResolvedValue({
        id: 'grant-scoped',
        isActive: true,
        revokedAt: null,
        expiresAt: null,
        scopes: ['free_busy'],
      });

      const result = await service.hasAccess('sarah', 'tom', 'calendar', 'events:create');
      expect(result).toBe(false);
    });

    it('should return false when grantor handle not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await service.hasAccess('sarah', 'nobody', 'calendar', 'free_busy');
      expect(result).toBe(false);
    });

    it('should audit denied access attempts', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'grantor-1' });
      mockPrisma.grant.findUnique.mockResolvedValue(null);

      await service.hasAccess('sarah', 'tom', 'calendar', 'free_busy');

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'access.denied',
          status: 'DENIED',
        }),
      });
    });

    it('should handle @ prefix in handles', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'grantor-1' });
      mockPrisma.grant.findUnique.mockResolvedValue({
        isActive: true,
        revokedAt: null,
        expiresAt: null,
        scopes: ['free_busy'],
      });

      const result = await service.hasAccess('@sarah', '@tom', 'calendar', 'free_busy');
      expect(result).toBe(true);
    });
  });

  // ─── requestAccess ────────────────────────────────────────────────

  describe('requestAccess', () => {
    const widget = { slug: 'calendar', scopes: ['free_busy', 'events:read'], isActive: true };

    beforeEach(() => {
      mockPrisma.widget.findUnique.mockResolvedValue(widget);
    });

    it('should auto-approve self-grants', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'user-1', handle: 'tom' }) // target
        .mockResolvedValueOnce({ id: 'user-1', handle: 'tom' }); // requestor
      mockPrisma.grant.upsert.mockResolvedValue({
        id: 'self-grant-1',
        granteeHandle: 'tom',
        widget: 'calendar',
        scopes: ['free_busy'],
        note: null,
        expiresAt: null,
      });

      const result = await service.requestAccess('user-1', {
        targetHandle: '@tom',
        widget: 'calendar',
        scopes: ['free_busy'],
      });

      expect(result.success).toBe(true);
      expect(result.autoApproved).toBe(true);
    });

    it('should block duplicate pending requests', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'user-2', handle: 'sarah' }) // target
        .mockResolvedValueOnce({ id: 'user-1', handle: 'tom' }); // requestor
      mockPrisma.grantRequest.findFirst
        .mockResolvedValueOnce({ id: 'existing-req', status: 'PENDING' }); // existing pending

      const result = await service.requestAccess('user-1', {
        targetHandle: '@sarah',
        widget: 'calendar',
        scopes: ['free_busy'],
      });

      expect(result.success).toBe(false);
      expect(result.existingRequestId).toBe('existing-req');
    });

    it('should enforce decline cooldown (7 days)', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'user-2', handle: 'sarah' }) // target
        .mockResolvedValueOnce({ id: 'user-1', handle: 'tom' }); // requestor
      mockPrisma.grantRequest.findFirst
        .mockResolvedValueOnce(null) // no pending
        .mockResolvedValueOnce({ // recent decline
          status: 'DECLINED',
          respondedAt: new Date(), // declined just now
        });

      const result = await service.requestAccess('user-1', {
        targetHandle: '@sarah',
        widget: 'calendar',
        scopes: ['free_busy'],
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('declined');
    });

    it('should enforce rate limit (10/hour)', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'user-2', handle: 'sarah' }) // target
        .mockResolvedValueOnce({ id: 'user-1', handle: 'tom' }); // requestor
      mockPrisma.grantRequest.findFirst
        .mockResolvedValue(null); // no pending, no decline
      mockPrisma.grantRequest.count.mockResolvedValue(10); // at limit

      await expect(
        service.requestAccess('user-1', {
          targetHandle: '@sarah',
          widget: 'calendar',
          scopes: ['free_busy'],
        }),
      ).rejects.toThrow(HttpException);
    });

    it('should create request and audit on success', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'user-2', handle: 'sarah' }) // target
        .mockResolvedValueOnce({ id: 'user-1', handle: 'tom' }); // requestor
      mockPrisma.grantRequest.findFirst.mockResolvedValue(null);
      mockPrisma.grantRequest.count
        .mockResolvedValueOnce(0) // rate limit
        .mockResolvedValueOnce(0); // inbox limit
      mockPrisma.grantRequest.create.mockResolvedValue({
        id: 'req-1',
        requestorHandle: 'tom',
        targetHandle: 'sarah',
        widget: 'calendar',
        scopes: ['free_busy'],
      });

      const result = await service.requestAccess('user-1', {
        targetHandle: '@sarah',
        widget: 'calendar',
        scopes: ['free_busy'],
      });

      expect(result.success).toBe(true);
      expect(result.requestId).toBe('req-1');
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'access.request',
          status: 'SUCCESS',
        }),
      });
    });
  });

  // ─── respondToRequest ─────────────────────────────────────────────

  describe('respondToRequest', () => {
    it('should approve and create grant', async () => {
      mockPrisma.grantRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        targetId: 'user-1',
        requestorHandle: 'tom',
        widget: 'calendar',
        scopes: ['free_busy'],
        status: 'PENDING',
      });
      mockPrisma.grantRequest.update.mockResolvedValue({});
      mockPrisma.widget.findUnique.mockResolvedValue({
        slug: 'calendar',
        scopes: ['free_busy', 'events:read', 'events:create'],
        isActive: true,
      });
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'grantee-1' });
      mockPrisma.grant.upsert.mockResolvedValue({
        id: 'grant-from-approve',
        granteeHandle: 'tom',
        widget: 'calendar',
        scopes: ['free_busy'],
        note: null,
        expiresAt: null,
      });

      const result = await service.respondToRequest('user-1', 'req-1', true);

      expect(result.status).toBe('APPROVED');
      expect(mockPrisma.grant.upsert).toHaveBeenCalled();
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'request.approve',
        }),
      });
    });

    it('should decline without creating grant', async () => {
      mockPrisma.grantRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        targetId: 'user-1',
        requestorHandle: 'tom',
        widget: 'calendar',
        scopes: ['free_busy'],
        status: 'PENDING',
      });
      mockPrisma.grantRequest.update.mockResolvedValue({});

      const result = await service.respondToRequest('user-1', 'req-1', false);

      expect(result.status).toBe('DECLINED');
      expect(mockPrisma.grant.upsert).not.toHaveBeenCalled();
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'request.decline',
        }),
      });
    });

    it('should throw if request not found', async () => {
      mockPrisma.grantRequest.findFirst.mockResolvedValue(null);

      await expect(service.respondToRequest('user-1', 'nonexistent', true)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Non-transitive trust ─────────────────────────────────────────

  describe('non-transitive trust', () => {
    it('Tom grants Alison, Alison grants Bob — Bob CANNOT access Tom', async () => {
      // Bob asks for Tom's calendar — Tom never granted Bob
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'tom-id' });
      mockPrisma.grant.findUnique.mockResolvedValue(null); // no grant from Tom to Bob

      const result = await service.hasAccess('bob', 'tom', 'calendar', 'free_busy');
      expect(result).toBe(false);
    });
  });

  // ─── Audit trail properties ───────────────────────────────────────

  describe('audit trail', () => {
    it('audit log create is fire-and-forget (does not block on failure)', async () => {
      mockPrisma.auditLog.create.mockRejectedValue(new Error('DB write failed'));
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'grantee-1' });
      mockPrisma.widget.findUnique.mockResolvedValue({
        slug: 'calendar',
        scopes: ['free_busy'],
        isActive: true,
      });
      mockPrisma.grant.upsert.mockResolvedValue({
        id: 'grant-1',
        granteeHandle: 'sarah',
        widget: 'calendar',
        scopes: ['free_busy'],
        note: null,
        expiresAt: null,
      });

      // Should not throw even though audit write fails
      const result = await service.createGrant('grantor-1', {
        granteeHandle: 'sarah',
        widget: 'calendar',
        scopes: ['free_busy'],
      });

      expect(result.id).toBe('grant-1');
    });
  });
});
