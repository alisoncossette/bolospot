import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { GrantsService } from './grants.service';
import { GrantsController } from './grants.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [PrismaModule, ApiKeysModule, AuthModule, EmailModule],
  controllers: [GrantsController],
  providers: [GrantsService],
  exports: [GrantsService],
})
export class GrantsModule implements OnModuleInit {
  private readonly logger = new Logger(GrantsModule.name);

  constructor(private grantsService: GrantsService) {}

  async onModuleInit() {
    try {
      await this.grantsService.seedWidgets();
    } catch (err) {
      this.logger.warn(`Widget seed skipped (table may not exist yet): ${err.message}`);
    }
  }
}
