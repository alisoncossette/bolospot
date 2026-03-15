import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { FirebaseAdminProvider } from '../../providers/firebase/firebase-admin.provider';
import { IdentityVerificationService } from './identity-verification.service';
import { IdentityVerificationController } from './identity-verification.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [IdentityVerificationController],
  providers: [IdentityVerificationService, FirebaseAdminProvider],
  exports: [IdentityVerificationService],
})
export class IdentityVerificationModule {}
