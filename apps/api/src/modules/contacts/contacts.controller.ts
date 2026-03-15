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
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiBody } from '@nestjs/swagger';
import { ContactsService } from './contacts.service';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { Request as ExpressRequest } from 'express';

interface AuthenticatedRequest extends ExpressRequest {
  user: { id: string };
}

@ApiTags('contacts')
@Controller('contacts')
@UseGuards(SessionAuthGuard)
@ApiBearerAuth()
export class ContactsController {
  constructor(private contactsService: ContactsService) {}

  @Get('trusted')
  @ApiOperation({ summary: 'List trusted contacts', description: 'Get all trusted contacts for the authenticated user' })
  @ApiResponse({ status: 200, description: 'Trusted contacts list returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async listTrustedContacts(@Request() req: AuthenticatedRequest) {
    return this.contactsService.listTrustedContacts(req.user.id);
  }

  @Post('trusted')
  @ApiOperation({ summary: 'Add trusted contact', description: 'Add a new trusted contact by handle or email with scheduling rules' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        handle: { type: 'string', example: 'johndoe' },
        email: { type: 'string', example: 'john@example.com' },
        autoApproveInvites: { type: 'boolean', description: 'Auto-approve meeting invites from this contact' },
        autoShareCalendar: { type: 'boolean', description: 'Automatically share calendar availability' },
        priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'VIP'], description: 'Contact priority for scheduling conflicts' },
        maxDuration: { type: 'number', nullable: true, description: 'Maximum meeting duration in minutes (null = no limit)' },
        maxFrequency: { type: 'string', nullable: true, enum: ['UNLIMITED', 'DAILY', 'WEEKLY', 'MONTHLY'], description: 'How often they can schedule meetings' },
        category: { type: 'string', nullable: true, description: 'Custom category (e.g., "team", "external", "recruiters")' },
        notes: { type: 'string', nullable: true, description: 'Free-form notes about this contact' },
        customHoursStart: { type: 'number', nullable: true, description: 'Custom bookable hours start (0-23). Must set with customHoursEnd.' },
        customHoursEnd: { type: 'number', nullable: true, description: 'Custom bookable hours end (0-23). Must set with customHoursStart.' },
        customDays: { type: 'array', items: { type: 'number' }, description: 'Custom bookable days (0=Sun, 6=Sat). Empty = use defaults.' },
        allowOverrideRequest: { type: 'boolean', description: 'Allow this contact to request meetings outside bookable hours' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Trusted contact added' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  async addTrustedContact(
    @Request() req: AuthenticatedRequest,
    @Body() body: {
      handle?: string;
      email?: string;
      autoApproveInvites?: boolean;
      autoShareCalendar?: boolean;
      priority?: string;
      maxDuration?: number | null;
      maxFrequency?: string | null;
      category?: string | null;
      notes?: string | null;
      customHoursStart?: number | null;
      customHoursEnd?: number | null;
      customDays?: number[];
      allowOverrideRequest?: boolean;
    },
  ) {
    return this.contactsService.addTrustedContact(req.user.id, body);
  }

  @Patch('trusted/:id')
  @ApiOperation({ summary: 'Update trusted contact', description: 'Update settings and scheduling rules for a trusted contact' })
  @ApiParam({ name: 'id', description: 'Trusted contact ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        autoApproveInvites: { type: 'boolean' },
        autoShareCalendar: { type: 'boolean' },
        status: { type: 'string', enum: ['APPROVED', 'BLOCKED'] },
        priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'VIP'] },
        maxDuration: { type: 'number', nullable: true },
        maxFrequency: { type: 'string', nullable: true, enum: ['UNLIMITED', 'DAILY', 'WEEKLY', 'MONTHLY'] },
        category: { type: 'string', nullable: true },
        notes: { type: 'string', nullable: true },
        preferredCalendarId: { type: 'string', nullable: true, description: 'Route meetings from this contact to specific calendar' },
        customHoursStart: { type: 'number', nullable: true, description: 'Custom bookable hours start (0-23)' },
        customHoursEnd: { type: 'number', nullable: true, description: 'Custom bookable hours end (0-23)' },
        customDays: { type: 'array', items: { type: 'number' }, description: 'Custom bookable days (0=Sun, 6=Sat)' },
        allowOverrideRequest: { type: 'boolean', description: 'Allow this contact to request meetings outside bookable hours' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Trusted contact updated' })
  @ApiResponse({ status: 404, description: 'Contact not found' })
  async updateTrustedContact(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: {
      autoApproveInvites?: boolean;
      autoShareCalendar?: boolean;
      status?: string;
      priority?: string;
      maxDuration?: number | null;
      maxFrequency?: string | null;
      category?: string | null;
      notes?: string | null;
      preferredCalendarId?: string | null;
      customHoursStart?: number | null;
      customHoursEnd?: number | null;
      customDays?: number[];
      allowOverrideRequest?: boolean;
    },
  ) {
    return this.contactsService.updateTrustedContact(req.user.id, id, body);
  }

  @Delete('trusted/:id')
  @ApiOperation({ summary: 'Remove trusted contact', description: 'Remove a contact from trusted list' })
  @ApiParam({ name: 'id', description: 'Trusted contact ID' })
  @ApiResponse({ status: 200, description: 'Trusted contact removed' })
  @ApiResponse({ status: 404, description: 'Contact not found' })
  async removeTrustedContact(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.contactsService.removeTrustedContact(req.user.id, id);
  }

  @Get('categories')
  @ApiOperation({ summary: 'List contact categories', description: 'Get all unique categories used by the authenticated user' })
  @ApiResponse({ status: 200, description: 'Categories list returned' })
  async getCategories(@Request() req: AuthenticatedRequest) {
    return this.contactsService.getCategories(req.user.id);
  }

  @Get('category/:category')
  @ApiOperation({ summary: 'List contacts by category', description: 'Get all contacts in a specific category' })
  @ApiParam({ name: 'category', description: 'Category name' })
  @ApiResponse({ status: 200, description: 'Contacts in category returned' })
  async getContactsByCategory(
    @Request() req: AuthenticatedRequest,
    @Param('category') category: string,
  ) {
    return this.contactsService.getContactsByCategory(req.user.id, category);
  }
}
