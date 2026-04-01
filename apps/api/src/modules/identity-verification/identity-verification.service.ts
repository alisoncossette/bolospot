import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FirebaseAdminProvider } from '../../providers/firebase/firebase-admin.provider';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class IdentityVerificationService {
  private readonly logger = new Logger(IdentityVerificationService.name);

  constructor(
    private prisma: PrismaService,
    private firebaseAdmin: FirebaseAdminProvider,
    private configService: ConfigService,
  ) {}

  async verifyPhoneWithFirebase(userId: string, firebaseIdToken: string) {
    if (!this.firebaseAdmin.isInitialized()) {
      throw new BadRequestException('Phone verification is not available');
    }

    // Verify the Firebase ID token
    const decodedToken = await this.firebaseAdmin.verifyIdToken(firebaseIdToken);
    if (!decodedToken) {
      throw new BadRequestException('Invalid verification token');
    }

    // Get the phone number from Firebase
    const phoneNumber = decodedToken.phone_number;
    if (!phoneNumber) {
      throw new BadRequestException('No phone number found in token');
    }

    // Get the PHONE identity type
    const phoneIdentityType = await this.prisma.identityType.findUnique({
      where: { code: 'PHONE' },
    });

    if (!phoneIdentityType) {
      throw new BadRequestException('Phone identity type not configured');
    }

    // Normalize phone number (remove spaces, ensure +prefix)
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);

    // Check if this phone is already verified by another user
    const existingIdentity = await this.prisma.userIdentity.findUnique({
      where: {
        identityTypeId_value: {
          identityTypeId: phoneIdentityType.id,
          value: normalizedPhone,
        },
      },
    });

    if (existingIdentity && existingIdentity.userId !== userId) {
      throw new BadRequestException('This phone number is already registered to another user');
    }

    // Create or update the user identity
    const identity = await this.prisma.userIdentity.upsert({
      where: {
        identityTypeId_value: {
          identityTypeId: phoneIdentityType.id,
          value: normalizedPhone,
        },
      },
      update: {
        isVerified: true,
        verifiedAt: new Date(),
        displayValue: phoneNumber,
      },
      create: {
        userId,
        identityTypeId: phoneIdentityType.id,
        value: normalizedPhone,
        displayValue: phoneNumber,
        isVerified: true,
        verifiedAt: new Date(),
        visibility: 'BOLO_ONLY',
      },
      include: {
        identityType: true,
      },
    });

    this.logger.log(`Phone verified for user ${userId}: ${normalizedPhone}`);

    return {
      success: true,
      identity: {
        id: identity.id,
        type: identity.identityType.code,
        value: identity.displayValue || identity.value,
        isVerified: identity.isVerified,
        verifiedAt: identity.verifiedAt,
      },
    };
  }

  async getUserIdentities(userId: string) {
    const identities = await this.prisma.userIdentity.findMany({
      where: { userId },
      include: { identityType: true },
      orderBy: { identityType: { sortOrder: 'asc' } },
    });

    return identities.map((identity) => ({
      id: identity.id,
      type: identity.identityType.code,
      typeName: identity.identityType.name,
      icon: identity.identityType.icon,
      value: identity.displayValue || identity.value,
      isVerified: identity.isVerified,
      verifiedAt: identity.verifiedAt,
      visibility: identity.visibility,
      isPrimary: identity.isPrimary,
    }));
  }

  async updateIdentityVisibility(
    userId: string,
    identityId: string,
    visibility: string,
  ) {
    const validVisibilities = ['PUBLIC', 'BOLO_ONLY', 'TRUSTED', 'HIDDEN'];
    if (!validVisibilities.includes(visibility)) {
      throw new BadRequestException('Invalid visibility value');
    }

    const identity = await this.prisma.userIdentity.findFirst({
      where: { id: identityId, userId },
    });

    if (!identity) {
      throw new BadRequestException('Identity not found');
    }

    return this.prisma.userIdentity.update({
      where: { id: identityId },
      data: { visibility },
      include: { identityType: true },
    });
  }

  async deleteIdentity(userId: string, identityId: string) {
    const identity = await this.prisma.userIdentity.findFirst({
      where: { id: identityId, userId },
      include: { identityType: true },
    });

    if (!identity) {
      throw new BadRequestException('Identity not found');
    }

    // Don't allow deleting BOLO_HANDLE identity
    if (identity.identityType.code === 'BOLO_HANDLE') {
      throw new BadRequestException('Cannot delete Bolo handle identity');
    }

    await this.prisma.userIdentity.delete({
      where: { id: identityId },
    });

    return { success: true };
  }

  private normalizePhoneNumber(phone: string): string {
    // Remove all non-digit characters except leading +
    let normalized = phone.replace(/[^\d+]/g, '');

    // Ensure it starts with +
    if (!normalized.startsWith('+')) {
      normalized = '+' + normalized;
    }

    return normalized;
  }

  async verifyWithWorldId(
    userId: string,
    payload: {
      merkle_root: string;
      nullifier_hash: string;
      proof: string;
      verification_level: string;
    },
    action: string,
  ) {
    const appId = this.configService.get<string>('WORLD_APP_ID');
    if (!appId) {
      throw new BadRequestException('World ID is not configured');
    }

    // Verify the proof with World ID cloud API
    const verifyRes = await fetch(
      `https://developer.worldcoin.org/api/v1/verify/${appId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nullifier_hash: payload.nullifier_hash,
          merkle_root: payload.merkle_root,
          proof: payload.proof,
          verification_level: payload.verification_level,
          action,
          signal: userId, // Bind proof to this specific user
        }),
      },
    );

    if (!verifyRes.ok) {
      const err = await verifyRes.json().catch(() => ({}));
      this.logger.warn(`World ID verification failed for user ${userId}: ${JSON.stringify(err)}`);
      throw new BadRequestException('World ID verification failed. Please try again.');
    }

    const verifyData = await verifyRes.json();

    // Check nullifier isn't already claimed by another user
    const existingUser = await this.prisma.user.findFirst({
      where: {
        worldIdNullifier: payload.nullifier_hash,
        id: { not: userId },
      },
    });

    if (existingUser) {
      throw new BadRequestException(
        'This World ID is already linked to another account.',
      );
    }

    // Get or create WORLD_ID identity type
    const worldIdType = await this.prisma.identityType.upsert({
      where: { code: 'WORLD_ID' },
      update: {},
      create: {
        code: 'WORLD_ID',
        name: 'World ID',
        icon: 'world-id',
        isActive: true,
        sortOrder: 5,
      },
    });

    // Store the identity
    const identity = await this.prisma.userIdentity.upsert({
      where: {
        identityTypeId_value: {
          identityTypeId: worldIdType.id,
          value: payload.nullifier_hash,
        },
      },
      update: {
        isVerified: true,
        verifiedAt: new Date(),
        metadata: {
          verification_level: payload.verification_level,
          merkle_root: payload.merkle_root,
        },
      },
      create: {
        userId,
        identityTypeId: worldIdType.id,
        value: payload.nullifier_hash,
        displayValue: 'World ID Verified',
        isVerified: true,
        verifiedAt: new Date(),
        visibility: 'BOLO_ONLY',
        metadata: {
          verification_level: payload.verification_level,
          merkle_root: payload.merkle_root,
        },
      },
      include: { identityType: true },
    });

    // Mark user as World ID verified
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        isWorldIdVerified: true,
        worldIdNullifier: payload.nullifier_hash,
        worldIdVerifiedAt: new Date(),
        isHumanVerified: true,
        verificationLevel: 'VERIFIED',
      },
    });

    this.logger.log(`World ID verified for user ${userId}`);

    return {
      success: true,
      identity: {
        id: identity.id,
        type: 'WORLD_ID',
        typeName: 'World ID',
        value: 'World ID Verified',
        isVerified: true,
        verifiedAt: identity.verifiedAt,
        verificationLevel: payload.verification_level,
      },
    };
  }

  isPhoneVerificationAvailable(): boolean {
    return this.firebaseAdmin.isInitialized();
  }

  async getIdentityTypes() {
    const types = await this.prisma.identityType.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    return types.map((type) => ({
      id: type.id,
      code: type.code,
      name: type.name,
      icon: type.icon,
      urlPattern: type.urlPattern,
    }));
  }
}
