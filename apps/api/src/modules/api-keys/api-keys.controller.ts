import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiBody } from '@nestjs/swagger';
import { ApiKeysService } from './api-keys.service';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';

interface CreateApiKeyBody {
  name: string;
  permissions: string[];
}

@ApiTags('api-keys')
@Controller('api-keys')
@UseGuards(SessionAuthGuard)
@ApiBearerAuth()
export class ApiKeysController {
  constructor(private apiKeysService: ApiKeysService) {}

  @Post()
  @ApiOperation({ summary: 'Create API key', description: 'Create a new API key with specified permissions' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'permissions'],
      properties: {
        name: { type: 'string', example: 'My Integration' },
        permissions: {
          type: 'array',
          items: { type: 'string' },
          example: ['availability:read', 'meetings:create'],
          description: 'Valid: availability:read, meetings:create, meetings:read',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'API key created (key shown only once)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createApiKey(@Request() req: any, @Body() body: CreateApiKeyBody) {
    const validPermissions = ['availability:read', 'meetings:create', 'meetings:read'];
    const permissions = body.permissions.filter((p: string) =>
      validPermissions.includes(p),
    );

    if (permissions.length === 0) {
      permissions.push('availability:read');
    }

    return this.apiKeysService.createApiKey(req.user.id, {
      name: body.name,
      permissions,
    });
  }

  @Get()
  @ApiOperation({ summary: 'List API keys', description: 'List all API keys for the authenticated user' })
  @ApiResponse({ status: 200, description: 'API keys list returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async listApiKeys(@Request() req: any) {
    return this.apiKeysService.listApiKeys(req.user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete API key', description: 'Revoke and delete an API key' })
  @ApiParam({ name: 'id', description: 'API key ID' })
  @ApiResponse({ status: 200, description: 'API key deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'API key not found' })
  async deleteApiKey(@Request() req: any, @Param('id') id: string) {
    return this.apiKeysService.deleteApiKey(req.user.id, id);
  }
}
