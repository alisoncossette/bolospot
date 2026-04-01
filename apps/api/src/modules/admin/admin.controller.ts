import { Controller, Get, Patch, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { SuperAdminGuard } from './superadmin.guard';
import { AdminService } from './admin.service';
import { SetBetaAccessDto, SetBetaAccessBulkDto } from './dto/admin.dto';

@ApiTags('admin')
@Controller('admin')
@UseGuards(SessionAuthGuard, SuperAdminGuard)
@ApiBearerAuth()
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get('users')
  @ApiOperation({ summary: 'List users (superadmin only)' })
  async listUsers(@Query('search') search?: string) {
    return this.adminService.listUsers(search);
  }

  @Get('beta-cohort')
  @ApiOperation({ summary: 'Get all beta users' })
  async getBetaCohort() {
    return this.adminService.getBetaCohort();
  }

  @Patch('beta-access')
  @ApiOperation({ summary: 'Set beta access for a user' })
  async setBetaAccess(
    @Body() body: SetBetaAccessDto,
  ) {
    return this.adminService.setBetaAccess(body.handle, body.betaAccess);
  }

  @Patch('beta-access/bulk')
  @ApiOperation({ summary: 'Set beta access for multiple users' })
  async setBetaAccessBulk(
    @Body() body: SetBetaAccessBulkDto,
  ) {
    return this.adminService.setBetaAccessBulk(body.handles, body.betaAccess);
  }
}
