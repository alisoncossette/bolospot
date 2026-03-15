import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseAdminProvider implements OnModuleInit {
  private readonly logger = new Logger(FirebaseAdminProvider.name);
  private app: admin.app.App | null = null;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const projectId =
      this.configService.get<string>('FIREBASE_PROJECT_ID') ||
      this.configService.get<string>('GCP_PROJECT_ID');

    if (!projectId) {
      this.logger.warn(
        'Firebase/GCP project ID not configured. Phone verification will be unavailable.',
      );
      return;
    }

    try {
      // Check if running in GCP (Cloud Run has this env var)
      const isGCP =
        process.env.K_SERVICE || process.env.GOOGLE_CLOUD_PROJECT;

      if (isGCP) {
        // Use Application Default Credentials in GCP
        this.app = admin.initializeApp({
          projectId,
        });
        this.logger.log(
          'Firebase Admin SDK initialized with Application Default Credentials',
        );
      } else {
        // For local development, use explicit credentials if provided
        const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');
        const privateKey = this.configService.get<string>('FIREBASE_PRIVATE_KEY');

        if (clientEmail && privateKey) {
          this.app = admin.initializeApp({
            credential: admin.credential.cert({
              projectId,
              clientEmail,
              privateKey: privateKey.replace(/\\n/g, '\n'),
            }),
          });
          this.logger.log('Firebase Admin SDK initialized with service account');
        } else {
          this.logger.warn(
            'Firebase credentials not configured for local development. Phone verification unavailable.',
          );
        }
      }
    } catch (error) {
      this.logger.error('Failed to initialize Firebase Admin SDK', error);
    }
  }

  async verifyIdToken(idToken: string): Promise<admin.auth.DecodedIdToken | null> {
    if (!this.app) {
      this.logger.error('Firebase Admin SDK not initialized');
      return null;
    }

    try {
      return await admin.auth().verifyIdToken(idToken);
    } catch (error) {
      this.logger.error('Failed to verify Firebase ID token', error);
      return null;
    }
  }

  async getUser(uid: string): Promise<admin.auth.UserRecord | null> {
    if (!this.app) {
      return null;
    }

    try {
      return await admin.auth().getUser(uid);
    } catch (error) {
      this.logger.error(`Failed to get Firebase user ${uid}`, error);
      return null;
    }
  }

  isInitialized(): boolean {
    return !!this.app;
  }
}
