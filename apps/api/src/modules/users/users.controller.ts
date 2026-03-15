import {
  Controller,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiBody } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { Request as ExpressRequest } from 'express';

interface AuthenticatedRequest extends ExpressRequest {
  user: { id: string };
}

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('handle/:handle')
  @ApiOperation({ summary: 'Get user by handle', description: 'Look up a public user profile by their handle' })
  @ApiParam({ name: 'handle', description: 'User handle (e.g., johndoe)' })
  @ApiResponse({ status: 200, description: 'User profile found' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getByHandle(@Param('handle') handle: string) {
    return this.usersService.findByHandle(handle);
  }

  @Get('check-handle/:handle')
  @ApiOperation({ summary: 'Check handle availability', description: 'Check if a handle is available for registration' })
  @ApiParam({ name: 'handle', description: 'Handle to check' })
  @ApiResponse({ status: 200, description: 'Returns availability status' })
  async checkHandle(@Param('handle') handle: string) {
    return this.usersService.checkHandleAvailability(handle);
  }

  @Patch('profile')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update user profile', description: 'Update the authenticated user profile settings' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'John Doe' },
        timezone: { type: 'string', example: 'America/New_York' },
        workingHoursStart: { type: 'number', example: 9, description: 'Hour (0-23)' },
        workingHoursEnd: { type: 'number', example: 17, description: 'Hour (0-23)' },
        workingDays: { type: 'array', items: { type: 'number' }, example: [1, 2, 3, 4, 5], description: 'Days (0=Sun, 6=Sat)' },
        bufferMinutes: { type: 'number', example: 15 },
        aiTools: { type: 'array', items: { type: 'string' }, example: ['tactiq', 'otter'] },
        recordingPref: { type: 'string', enum: ['ALWAYS', 'ASK', 'NEVER'] },
        busyBlockSyncMinutes: { type: 'number', example: 60, description: 'Busy block sync interval in minutes' },
        busyBlockTitle: { type: 'string', example: 'Busy (Bolo)', description: 'Custom title for busy block events' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Profile updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async updateProfile(
    @Request() req: AuthenticatedRequest,
    @Body()
    data: {
      name?: string;
      timezone?: string;
      workingHoursStart?: number;
      workingHoursEnd?: number;
      workingDays?: number[];
      bufferMinutes?: number;
      aiTools?: string[];
      recordingPref?: string;
      busyBlockSyncMinutes?: number;
      busyBlockTitle?: string;
    },
  ) {
    return this.usersService.updateProfile(req.user.id, data);
  }

  @Get('profile')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user profile', description: 'Get the authenticated user full profile' })
  @ApiResponse({ status: 200, description: 'User profile returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getProfile(@Request() req: AuthenticatedRequest) {
    return this.usersService.findById(req.user.id);
  }

  @Delete('account')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete account', description: 'Permanently delete the authenticated user account' })
  @ApiResponse({ status: 200, description: 'Account deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async deleteAccount(@Request() req: AuthenticatedRequest) {
    return this.usersService.deleteAccount(req.user.id);
  }

  @Get('activity')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get recent activity', description: 'Get recent activity for the authenticated user' })
  @ApiResponse({ status: 200, description: 'Activity list returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getRecentActivity(@Request() req: AuthenticatedRequest) {
    return this.usersService.getRecentActivity(req.user.id);
  }
}
