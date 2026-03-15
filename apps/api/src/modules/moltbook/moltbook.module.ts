import { Module } from '@nestjs/common';
import { MoltbookService } from './moltbook.service';
import { MoltbookIdentityGuard } from './moltbook-identity.guard';
import { DualAuthGuard } from './dual-auth.guard';
import { PrismaModule } from '../../prisma/prisma.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';

@Module({
  imports: [PrismaModule, ApiKeysModule],
  providers: [MoltbookService, MoltbookIdentityGuard, DualAuthGuard],
  exports: [MoltbookService, MoltbookIdentityGuard, DualAuthGuard],
})
export class MoltbookModule {}
