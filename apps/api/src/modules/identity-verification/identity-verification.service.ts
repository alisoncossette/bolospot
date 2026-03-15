import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FirebaseAdminProvider } from '../../providers/firebase/firebase-admin.provider';

@Injectable()
export class IdentityVerificationService {
  private readonly logger = new Logger(IdentityVerificationService.name);

  constructor(
    private prisma: PrismaService,
    private firebaseAdmin: FirebaseAdminProvider,
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
