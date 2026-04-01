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
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { ApprovalsService } from './approvals.service';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { RespondToApprovalDto } from './dto/approvals.dto';

@ApiTags('approvals')
@Controller('approvals')
@UseGuards(SessionAuthGuard)
@ApiBearerAuth()
export class ApprovalsController {
  constructor(private approvalsService: ApprovalsService) {}

  @Get()
  @ApiOperation({ summary: 'List approvals', description: 'List approval requests for the authenticated user' })
  @ApiQuery({ name: 'filter', required: false, enum: ['pending', 'completed', 'all'], description: 'Filter by status' })
  @ApiResponse({ status: 200, description: 'Approvals list returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async listApprovals(
    @Request() req: any,
    @Query('filter') filter?: 'pending' | 'completed' | 'all',
  ) {
    return this.approvalsService.listApprovals(req.user.id, filter || 'all');
  }

  @Get('pending-count')
  @ApiOperation({ summary: 'Get pending count', description: 'Get count of pending approval requests' })
  @ApiResponse({ status: 200, description: 'Pending count returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getPendingCount(@Request() req: any) {
    return this.approvalsService.getPendingCount(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get approval', description: 'Get details of a specific approval request' })
  @ApiParam({ name: 'id', description: 'Approval ID' })
  @ApiResponse({ status: 200, description: 'Approval returned' })
  @ApiResponse({ status: 404, description: 'Approval not found' })
  async getApproval(@Request() req: any, @Param('id') id: string) {
    return this.approvalsService.getApproval(req.user.id, id);
  }

  @Post(':id/respond')
  @ApiOperation({ summary: 'Respond to approval', description: 'Approve or deny an approval request' })
  @ApiParam({ name: 'id', description: 'Approval ID' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['status'],
      properties: {
        status: { type: 'string', enum: ['APPROVED', 'DENIED'] },
        responseNote: { type: 'string', description: 'Optional note with response' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Response recorded' })
  @ApiResponse({ status: 404, description: 'Approval not found' })
  async respondToApproval(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: RespondToApprovalDto,
  ) {
    return this.approvalsService.respondToApproval(req.user.id, id, body);
  }
}
