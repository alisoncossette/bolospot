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
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { IdentityVerificationService } from './identity-verification.service';
import { Request as ExpressRequest } from 'express';

interface AuthenticatedRequest extends ExpressRequest {
  user: { id: string };
}

class VerifyPhoneDto {
  @IsString()
  firebaseIdToken: string;
}

class UpdateVisibilityDto {
  @IsString()
  visibility: string;
}

@ApiTags('identities')
@Controller('identities')
export class IdentityVerificationController {
  constructor(
    private readonly identityVerificationService: IdentityVerificationService,
  ) {}

  @Get('types')
  @ApiOperation({ summary: 'Get available identity types' })
  async getIdentityTypes() {
    return this.identityVerificationService.getIdentityTypes();
  }

  @Get()
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user identities' })
  async getMyIdentities(@Request() req: AuthenticatedRequest) {
    return this.identityVerificationService.getUserIdentities(req.user.id);
  }

  @Get('verification-status')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Check phone verification availability' })
  async getVerificationStatus() {
    return {
      phoneVerificationAvailable:
        this.identityVerificationService.isPhoneVerificationAvailable(),
    };
  }

  @Post('verify-phone')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify phone number with Firebase token' })
  async verifyPhone(
    @Request() req: AuthenticatedRequest,
    @Body() dto: VerifyPhoneDto,
  ) {
    return this.identityVerificationService.verifyPhoneWithFirebase(
      req.user.id,
      dto.firebaseIdToken,
    );
  }

  @Patch(':id/visibility')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update identity visibility' })
  async updateVisibility(
    @Request() req: AuthenticatedRequest,
    @Param('id') identityId: string,
    @Body() dto: UpdateVisibilityDto,
  ) {
    return this.identityVerificationService.updateIdentityVisibility(
      req.user.id,
      identityId,
      dto.visibility,
    );
  }

  @Delete(':id')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete an identity' })
  async deleteIdentity(
    @Request() req: AuthenticatedRequest,
    @Param('id') identityId: string,
  ) {
    return this.identityVerificationService.deleteIdentity(
      req.user.id,
      identityId,
    );
  }
}
