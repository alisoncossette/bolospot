import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity, ApiBody, ApiParam, ApiQuery } from '@nestjs/swagger';
import { RelayService } from './relay.service';
import { ApiKeyGuard } from '../api-keys/api-key.guard';
import { ApiKeyThrottleGuard } from '../api-keys/api-key-throttle.guard';
import { RateLimit } from '../api-keys/api-key-throttle.guard';
import { UsageGuard } from '../billing/usage.guard';
import { UsageMetric } from '../billing/usage.guard';

@ApiTags('relay')
@Controller('relay')
export class RelayController {
  constructor(private relayService: RelayService) {}

  // ─── Send a query through the relay ──────────────────────────────

  @Post('send')
  @UseGuards(ApiKeyGuard, ApiKeyThrottleGuard, UsageGuard)
  @RateLimit(30, 60)
  @UsageMetric('relay_send')
  @ApiSecurity('api-key')
  @ApiOperation({
    summary: 'Send relay query',
    description: 'Send a query to another @handle through the trust boundary. Requires a grant for the specified widget.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['recipientHandle', 'content'],
      properties: {
        recipientHandle: { type: 'string', example: '@bob' },
        content: { type: 'string', example: 'Is Bob free at 9am on Tuesday?' },
        widgetSlug: { type: 'string', example: 'dating', description: 'Widget context (default: relay)' },
        scope: { type: 'string', example: 'query:send', description: 'Required scope (default: query:send)' },
        metadata: { type: 'object', description: 'Optional structured data' },
        conversationId: { type: 'string', description: 'Continue an existing conversation thread' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Query sent' })
  @ApiResponse({ status: 403, description: 'No grant for this widget/scope' })
  @ApiResponse({ status: 409, description: 'Rate limited or max pending reached' })
  async sendQuery(@Request() req: any, @Body() body: any) {
    return this.relayService.sendQuery(req.apiKeyUser.handle, {
      recipientHandle: body.recipientHandle,
      content: body.content,
      widgetSlug: body.widgetSlug,
      scope: body.scope,
      metadata: body.metadata,
      conversationId: body.conversationId,
    });
  }

  // ─── Reply to a query in your inbox ──────────────────────────────

  @Post(':messageId/reply')
  @UseGuards(ApiKeyGuard, ApiKeyThrottleGuard, UsageGuard)
  @RateLimit(30, 60)
  @UsageMetric('relay_reply')
  @ApiSecurity('api-key')
  @ApiOperation({
    summary: 'Reply to relay query',
    description: 'Reply to a query in your inbox. Only include crafted responses — never raw data.',
  })
  @ApiParam({ name: 'messageId', description: 'ID of the query message to reply to' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['content'],
      properties: {
        content: { type: 'string', example: 'Bob is available Tuesday 10:00-10:30am PT' },
        metadata: { type: 'object', description: 'Optional structured data' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Response sent' })
  async replyToQuery(
    @Request() req: any,
    @Param('messageId') messageId: string,
    @Body() body: any,
  ) {
    return this.relayService.respondToQuery(req.apiKeyUser.handle, messageId, {
      content: body.content,
      metadata: body.metadata,
    });
  }

  // ─── Poll pending queries (inbox) ────────────────────────────────

  @Get('inbox')
  @UseGuards(ApiKeyGuard, ApiKeyThrottleGuard)
  @RateLimit(120, 60)
  @ApiSecurity('api-key')
  @ApiOperation({
    summary: 'Check relay inbox',
    description: 'Poll for pending queries addressed to you from other agents.',
  })
  @ApiQuery({ name: 'since', required: false, description: 'ISO datetime — only fetch messages after this time' })
  @ApiResponse({ status: 200, description: 'Pending queries' })
  async getInbox(@Request() req: any, @Query('since') since?: string) {
    return this.relayService.getPendingMessages(
      req.apiKeyUser.handle,
      since ? new Date(since) : undefined,
    );
  }

  // ─── Poll for responses to queries you sent ──────────────────────

  @Get('responses')
  @UseGuards(ApiKeyGuard, ApiKeyThrottleGuard)
  @RateLimit(120, 60)
  @ApiSecurity('api-key')
  @ApiOperation({
    summary: 'Check relay responses',
    description: 'Poll for responses to queries you previously sent.',
  })
  @ApiQuery({ name: 'since', required: false, description: 'ISO datetime — only fetch responses after this time' })
  @ApiResponse({ status: 200, description: 'Responses to your queries' })
  async getResponses(@Request() req: any, @Query('since') since?: string) {
    return this.relayService.getResponses(
      req.apiKeyUser.handle,
      since ? new Date(since) : undefined,
    );
  }

  // ─── Acknowledge messages ────────────────────────────────────────

  @Post('ack')
  @UseGuards(ApiKeyGuard, ApiKeyThrottleGuard)
  @RateLimit(60, 60)
  @ApiSecurity('api-key')
  @ApiOperation({
    summary: 'Acknowledge messages',
    description: 'Mark relay messages as delivered.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['messageIds'],
      properties: {
        messageIds: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Messages acknowledged' })
  async acknowledgeMessages(@Request() req: any, @Body() body: any) {
    return this.relayService.markDelivered(req.apiKeyUser.handle, body.messageIds);
  }
}
