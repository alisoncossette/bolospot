import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { ConnectionsService } from './connections.service';

@Injectable()
export class BusyBlockSyncJob {
  private readonly logger = new Logger(BusyBlockSyncJob.name);
  private isRunning = false;

  constructor(
    private prisma: PrismaService,
    private connectionsService: ConnectionsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleBusyBlockSync() {
    if (this.isRunning) {
      this.logger.log('Busy block sync already running, skipping');
      return;
    }

    this.isRunning = true;
    try {
      // Find users with busy block enabled, including their sync interval preference
      const usersWithBusyBlock = await this.prisma.calendar.findMany({
        where: { isBusyBlock: true, connection: { isEnabled: true } },
        select: {
          connection: {
            select: {
              userId: true,
              user: {
                select: {
                  id: true,
                  busyBlockSyncMinutes: true,
                  lastBusyBlockSyncAt: true,
                },
              },
            },
          },
        },
        distinct: ['connectionId'],
      });

      // Deduplicate by userId
      const usersMap = new Map<string, { busyBlockSyncMinutes: number; lastBusyBlockSyncAt: Date | null }>();
      for (const cal of usersWithBusyBlock) {
        const user = cal.connection.user;
        if (!usersMap.has(user.id)) {
          usersMap.set(user.id, {
            busyBlockSyncMinutes: user.busyBlockSyncMinutes,
            lastBusyBlockSyncAt: user.lastBusyBlockSyncAt,
          });
        }
      }

      if (usersMap.size === 0) {
        return;
      }

      const now = new Date();
      let syncedCount = 0;

      for (const [userId, prefs] of usersMap) {
        // Check if enough time has passed since last sync
        const intervalMs = prefs.busyBlockSyncMinutes * 60 * 1000;
        if (prefs.lastBusyBlockSyncAt) {
          const elapsed = now.getTime() - prefs.lastBusyBlockSyncAt.getTime();
          if (elapsed < intervalMs) {
            continue; // Not time yet for this user
          }
        }

        try {
          const result = await this.connectionsService.syncBusyBlocks(userId);

          // Update last sync timestamp
          await this.prisma.user.update({
            where: { id: userId },
            data: { lastBusyBlockSyncAt: now },
          });

          syncedCount++;
          if (result.errors.length > 0) {
            this.logger.warn(`Busy block sync for user ${userId}: ${result.synced} synced, ${result.errors.length} errors`);
          }
        } catch (error) {
          this.logger.error(`Busy block sync failed for user ${userId}: ${error.message}`);
        }
      }

      if (syncedCount > 0) {
        this.logger.log(`Scheduled busy block sync: processed ${syncedCount}/${usersMap.size} user(s)`);
      }
    } finally {
      this.isRunning = false;
    }
  }
}
