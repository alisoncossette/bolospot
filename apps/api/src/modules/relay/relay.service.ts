import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Logger,
  Inject,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { GrantsService } from '../grants/grants.service';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

const QUERY_TTL_HOURS = 24;
const RESPONSE_TTL_HOURS = 1;
const MAX_PENDING_PER_PAIR = 5;
const MAX_QUERIES_PER_HOUR_PER_PAIR = 20;

@Injectable()
export class RelayService {
  private readonly logger = new Logger(RelayService.name);

  constructor(
    private prisma: PrismaService,
    private grantsService: GrantsService,
    @Inject(REDIS_CLIENT) private redis: Redis | null,
  ) {}

  /**
   * Send a query to another @handle through the relay.
   * Checks grant for the specified widget+scope.
   */
  async sendQuery(
    senderHandle: string,
    dto: {
      recipientHandle: string;
      content: string;
      widgetSlug?: string;
      scope?: string;
      metadata?: any;
      conversationId?: string;
    },
  ) {
    const cleanSender = senderHandle.startsWith('@') ? senderHandle.slice(1) : senderHandle;
    const cleanRecipient = dto.recipientHandle.startsWith('@')
      ? dto.recipientHandle.slice(1)
      : dto.recipientHandle;

    // Resolve recipient
    const recipient = await this.prisma.user.findUnique({
      where: { handle: cleanRecipient.toLowerCase() },
      select: { id: true, handle: true },
    });
    if (!recipient) {
      throw new NotFoundException(`Handle @${cleanRecipient} not found`);
    }

    // Resolve sender
    const sender = await this.prisma.user.findUnique({
      where: { handle: cleanSender.toLowerCase() },
      select: { id: true, handle: true },
    });

    // Check grant: recipient must have granted sender access to the widget
    const widget = dto.widgetSlug || 'relay';
    const scope = dto.scope || 'query:send';

    const hasAccess = await this.grantsService.hasAccess(
      cleanSender,
      cleanRecipient,
      widget,
      scope,
    );
    if (!hasAccess) {
      throw new ForbiddenException(
        `@${cleanSender} does not have ${widget}:${scope} access from @${cleanRecipient}`,
      );
    }

    // Anti-spam: max pending queries per sender→recipient pair
    const pendingCount = await this.prisma.relayMessage.count({
      where: {
        senderHandle: cleanSender.toLowerCase(),
        recipientHandle: cleanRecipient.toLowerCase(),
        direction: 'query',
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
    });
    if (pendingCount >= MAX_PENDING_PER_PAIR) {
      throw new ConflictException(
        `Max ${MAX_PENDING_PER_PAIR} unanswered queries to @${cleanRecipient}. Wait for responses or let them expire.`,
      );
    }

    // Anti-spam: rate limit per pair (Redis-backed)
    if (this.redis && this.redis.status === 'ready') {
      const pairKey = `relay:rate:${cleanSender.toLowerCase()}:${cleanRecipient.toLowerCase()}`;
      const count = await this.redis.incr(pairKey);
      if (count === 1) await this.redis.expire(pairKey, 3600);
      if (count > MAX_QUERIES_PER_HOUR_PER_PAIR) {
        throw new ConflictException(
          `Max ${MAX_QUERIES_PER_HOUR_PER_PAIR} queries per hour to @${cleanRecipient}`,
        );
      }
    }

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + QUERY_TTL_HOURS);

    const message = await this.prisma.relayMessage.create({
      data: {
        senderHandle: cleanSender.toLowerCase(),
        senderId: sender?.id,
        recipientHandle: cleanRecipient.toLowerCase(),
        recipientId: recipient.id,
        widgetSlug: widget,
        direction: 'query',
        content: dto.content,
        metadata: dto.metadata || undefined,
        conversationId: dto.conversationId || undefined,
        expiresAt,
      },
    });

    this.logger.log(
      `Relay query: @${cleanSender} → @${cleanRecipient} (${widget}:${scope}) [${message.id}]`,
    );

    return {
      id: message.id,
      conversationId: message.conversationId,
      status: message.status,
      expiresAt: message.expiresAt,
    };
  }

  /**
   * Reply to a query in your inbox.
   * No grant check needed — you can always reply to messages addressed to you.
   */
  async respondToQuery(
    responderHandle: string,
    messageId: string,
    dto: { content: string; metadata?: any },
  ) {
    const cleanResponder = responderHandle.startsWith('@')
      ? responderHandle.slice(1)
      : responderHandle;

    // Find the original query
    const query = await this.prisma.relayMessage.findUnique({
      where: { id: messageId },
    });
    if (!query) throw new NotFoundException('Query message not found');
    if (query.direction !== 'query') throw new ConflictException('Can only reply to query messages');
    if (query.recipientHandle !== cleanResponder.toLowerCase()) {
      throw new ForbiddenException('You can only reply to messages addressed to you');
    }
    if (query.status === 'EXPIRED') throw new ConflictException('This query has expired');

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + RESPONSE_TTL_HOURS);

    // Create response and mark query as delivered in a transaction
    const [response] = await this.prisma.$transaction([
      this.prisma.relayMessage.create({
        data: {
          senderHandle: cleanResponder.toLowerCase(),
          senderId: query.recipientId,
          recipientHandle: query.senderHandle,
          recipientId: query.senderId || '',
          widgetSlug: query.widgetSlug,
          direction: 'response',
          parentMessageId: query.id,
          content: dto.content,
          metadata: dto.metadata || undefined,
          conversationId: query.conversationId,
          expiresAt,
        },
      }),
      this.prisma.relayMessage.update({
        where: { id: query.id },
        data: { status: 'DELIVERED', deliveredAt: new Date() },
      }),
    ]);

    this.logger.log(
      `Relay response: @${cleanResponder} → @${query.senderHandle} [${response.id}] (re: ${query.id})`,
    );

    return {
      id: response.id,
      parentMessageId: query.id,
      conversationId: response.conversationId,
      status: response.status,
    };
  }

  /**
   * Get pending queries addressed to this handle.
   */
  async getPendingMessages(handle: string, since?: Date) {
    const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle;

    const where: any = {
      recipientHandle: cleanHandle.toLowerCase(),
      direction: 'query',
      status: 'PENDING',
      expiresAt: { gt: new Date() },
    };
    if (since) {
      where.createdAt = { gt: since };
    }

    const messages = await this.prisma.relayMessage.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        senderHandle: true,
        widgetSlug: true,
        content: true,
        metadata: true,
        conversationId: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    return { messages, count: messages.length };
  }

  /**
   * Get responses to queries this handle sent.
   */
  async getResponses(handle: string, since?: Date) {
    const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle;

    const where: any = {
      recipientHandle: cleanHandle.toLowerCase(),
      direction: 'response',
      status: 'PENDING',
    };
    if (since) {
      where.createdAt = { gt: since };
    }

    const messages = await this.prisma.relayMessage.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        senderHandle: true,
        parentMessageId: true,
        widgetSlug: true,
        content: true,
        metadata: true,
        conversationId: true,
        createdAt: true,
      },
    });

    return { messages, count: messages.length };
  }

  /**
   * Acknowledge (mark as delivered) messages.
   */
  async markDelivered(handle: string, messageIds: string[]) {
    const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle;

    const result = await this.prisma.relayMessage.updateMany({
      where: {
        id: { in: messageIds },
        recipientHandle: cleanHandle.toLowerCase(),
        status: 'PENDING',
      },
      data: {
        status: 'DELIVERED',
        deliveredAt: new Date(),
      },
    });

    return { acknowledged: result.count };
  }

  /**
   * Expire old messages. Runs every 15 minutes.
   */
  @Cron('0 */15 * * * *')
  async expireMessages() {
    const result = await this.prisma.relayMessage.updateMany({
      where: {
        status: 'PENDING',
        expiresAt: { lt: new Date() },
      },
      data: { status: 'EXPIRED' },
    });

    if (result.count > 0) {
      this.logger.log(`Expired ${result.count} relay messages`);
    }
  }
}
