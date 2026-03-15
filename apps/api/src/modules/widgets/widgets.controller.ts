import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity, ApiBody, ApiParam } from '@nestjs/swagger';
import { WidgetsService } from './widgets.service';
import { ApiKeyGuard } from '../api-keys/api-key.guard';
import { ApiKeyThrottleGuard } from '../api-keys/api-key-throttle.guard';
import { RateLimit } from '../api-keys/api-key-throttle.guard';

@ApiTags('widgets')
@Controller('widgets')
export class WidgetsController {
  constructor(private widgetsService: WidgetsService) {}

  // ─── Public: list all widgets ─────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List widgets', description: 'List all active permission categories (built-in + registered)' })
  @ApiResponse({ status: 200, description: 'List of widgets' })
  async listWidgets() {
    return this.widgetsService.listWidgets();
  }

  // ─── API Key authenticated: register/update/delete ────────────────

  @Post('register')
  @UseGuards(ApiKeyGuard, ApiKeyThrottleGuard)
  @RateLimit(10, 60)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Register widget', description: 'Register a new permission category for your app' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['slug', 'name', 'scopes'],
      properties: {
        slug: { type: 'string', example: 'dating', description: 'Unique widget identifier' },
        name: { type: 'string', example: 'Dating', description: 'Display name' },
        description: { type: 'string', example: 'Simulated dating through agent relay' },
        icon: { type: 'string', example: '💕' },
        scopes: {
          type: 'array',
          items: { type: 'string' },
          example: ['date:initiate', 'date:respond', 'profile:share'],
        },
        callbackUrl: { type: 'string', example: 'https://bolove.app/webhook' },
        tosUrl: { type: 'string', example: 'https://bolove.app/terms', description: 'URL to the widget terms of service' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Widget registered' })
  async registerWidget(@Request() req: any, @Body() body: any) {
    return this.widgetsService.registerWidget(req.apiKeyUser.id, {
      slug: body.slug,
      name: body.name,
      description: body.description,
      icon: body.icon,
      scopes: body.scopes,
      callbackUrl: body.callbackUrl,
      tosUrl: body.tosUrl,
    });
  }

  @Patch(':slug')
  @UseGuards(ApiKeyGuard, ApiKeyThrottleGuard)
  @RateLimit(10, 60)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Update widget', description: 'Update a registered widget (owner only)' })
  @ApiParam({ name: 'slug', description: 'Widget slug' })
  async updateWidget(@Request() req: any, @Param('slug') slug: string, @Body() body: any) {
    return this.widgetsService.updateWidget(req.apiKeyUser.id, slug, {
      name: body.name,
      description: body.description,
      icon: body.icon,
      scopes: body.scopes,
      tosUrl: body.tosUrl,
    });
  }

  @Delete(':slug')
  @UseGuards(ApiKeyGuard, ApiKeyThrottleGuard)
  @RateLimit(10, 60)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Deactivate widget', description: 'Deactivate a registered widget (owner only)' })
  @ApiParam({ name: 'slug', description: 'Widget slug' })
  async deactivateWidget(@Request() req: any, @Param('slug') slug: string) {
    return this.widgetsService.deactivateWidget(req.apiKeyUser.id, slug);
  }
}
