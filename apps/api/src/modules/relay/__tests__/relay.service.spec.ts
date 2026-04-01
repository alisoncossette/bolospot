import { Test, TestingModule } from '@nestjs/testing';
import { RelayService } from '../relay.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { GrantsService } from '../../grants/grants.service';
import { NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { REDIS_CLIENT } from '../../redis/redis.module';

const mockPrisma = {
  user: { findUnique: jest.fn() },
  relayMessage: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
};

const mockGrantsService = {
  hasAccess: jest.fn(),
};

const mockRedis = {
  status: 'ready',
  incr: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1),
};

describe('RelayService', () => {
  let service: RelayService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RelayService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: GrantsService, useValue: mockGrantsService },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    service = module.get<RelayService>(RelayService);
  });

  // ─── sendQuery ──────────────────────────────────────────────────

  describe('sendQuery', () => {
    it('should send a query when grant exists', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'recipient-1', handle: 'sarah' }) // recipient
        .mockResolvedValueOnce({ id: 'sender-1', handle: 'tom' }); // sender
      mockGrantsService.hasAccess.mockResolvedValue(true);
      mockPrisma.relayMessage.count.mockResolvedValue(0);
      mockPrisma.relayMessage.create.mockResolvedValue({
        id: 'msg-1',
        senderHandle: 'tom',
        recipientHandle: 'sarah',
        content: 'Are you free Tuesday?',
        direction: 'query',
        status: 'PENDING',
        conversationId: null,
        expiresAt: new Date(Date.now() + 86400000),
      });

      const result = await service.sendQuery('tom', {
        recipientHandle: '@sarah',
        content: 'Are you free Tuesday?',
      });

      expect(result).toBeDefined();
      expect(mockGrantsService.hasAccess).toHaveBeenCalledWith('tom', 'sarah', 'relay', 'query:send');
    });

    it('should throw ForbiddenException when no grant', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'recipient-1', handle: 'sarah' });
      mockGrantsService.hasAccess.mockResolvedValue(false);

      await expect(
        service.sendQuery('tom', {
          recipientHandle: '@sarah',
          content: 'hello',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException for unknown recipient', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null); // recipient not found

      await expect(
        service.sendQuery('tom', {
          recipientHandle: '@nobody',
          content: 'hello',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should enforce max pending queries per pair', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'recipient-1', handle: 'sarah' })
        .mockResolvedValueOnce({ id: 'sender-1', handle: 'tom' });
      mockGrantsService.hasAccess.mockResolvedValue(true);
      mockPrisma.relayMessage.count.mockResolvedValue(5); // MAX_PENDING_PER_PAIR

      await expect(
        service.sendQuery('tom', {
          recipientHandle: '@sarah',
          content: 'hello again',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should use custom widget and scope from dto', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'recipient-1', handle: 'sarah' })
        .mockResolvedValueOnce({ id: 'sender-1', handle: 'tom' });
      mockGrantsService.hasAccess.mockResolvedValue(true);
      mockPrisma.relayMessage.count.mockResolvedValue(0);
      mockPrisma.relayMessage.create.mockResolvedValue({
        id: 'msg-2',
        senderHandle: 'tom',
        recipientHandle: 'sarah',
        content: 'Match request',
        direction: 'query',
        status: 'PENDING',
        conversationId: null,
        expiresAt: new Date(),
      });

      await service.sendQuery('tom', {
        recipientHandle: '@sarah',
        content: 'Match request',
        widgetSlug: 'bolove',
        scope: 'date:initiate',
      });

      expect(mockGrantsService.hasAccess).toHaveBeenCalledWith('tom', 'sarah', 'bolove', 'date:initiate');
    });

    it('should enforce Redis rate limit per pair', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'recipient-1', handle: 'sarah' })
        .mockResolvedValueOnce({ id: 'sender-1', handle: 'tom' });
      mockGrantsService.hasAccess.mockResolvedValue(true);
      mockPrisma.relayMessage.count.mockResolvedValue(0);
      mockRedis.incr.mockResolvedValue(21); // over MAX_QUERIES_PER_HOUR_PER_PAIR (20)

      await expect(
        service.sendQuery('tom', {
          recipientHandle: '@sarah',
          content: 'spam',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── Trust boundary: raw data never leaks ─────────────────────────

  describe('trust boundary', () => {
    it('relay requires explicit grant — no transitive access', async () => {
      // Bob has a grant from Alison, but NOT from Tom
      // Bob tries to relay to Tom
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'tom-1', handle: 'tom' });
      mockGrantsService.hasAccess.mockResolvedValue(false); // Tom never granted Bob

      await expect(
        service.sendQuery('bob', {
          recipientHandle: '@tom',
          content: 'Are you free?',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
