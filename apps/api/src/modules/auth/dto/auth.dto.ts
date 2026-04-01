import { IsEmail, IsString, MinLength, MaxLength, IsOptional, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com', description: 'User email address' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Secure#pass1', minLength: 8, description: 'Password (min 8 chars, must include uppercase, lowercase, number, and special character)' })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/, {
    message: 'Password must include at least one uppercase letter, one lowercase letter, one number, and one special character',
  })
  password: string;

  @ApiProperty({ example: 'johndoe', description: 'Unique handle (lowercase, numbers, underscores only)' })
  @IsString()
  @Matches(/^[a-z0-9_]+$/, {
    message: 'Handle can only contain lowercase letters, numbers, and underscores',
  })
  @MinLength(3)
  handle: string;

  @ApiPropertyOptional({ example: 'John Doe', description: 'Display name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'America/New_York', description: 'User timezone' })
  @IsOptional()
  @IsString()
  timezone?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'user@example.com', description: 'User email address' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'securepassword123', description: 'User password' })
  @IsString()
  password: string;
}

export class EmailAuthSendDto {
  @ApiProperty({ example: 'user@example.com', description: 'Email address to send auth code/link to' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'otp', enum: ['otp', 'link'], description: 'Auth method: OTP code or magic link' })
  @IsString()
  method: 'otp' | 'link';
}

export class EmailAuthVerifyDto {
  @ApiProperty({ example: 'user@example.com', description: 'Email address' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '384291', description: '6-digit OTP code' })
  @IsString()
  code: string;
}

export class OnboardingDto {
  @ApiProperty({ example: 'johndoe', description: 'Unique handle (lowercase, numbers, underscores only)' })
  @IsString()
  @Matches(/^[a-z0-9_]+$/, {
    message: 'Handle can only contain lowercase letters, numbers, and underscores',
  })
  @MinLength(3)
  @MaxLength(20)
  handle: string;

  @ApiPropertyOptional({ example: 'John Doe', description: 'Display name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'America/New_York', description: 'User timezone' })
  @IsOptional()
  @IsString()
  timezone?: string;
}

export class UserResponseDto {
  @ApiProperty({ example: 'clx123abc', description: 'User ID' })
  id: string;

  @ApiProperty({ example: 'user@example.com' })
  email: string;

  @ApiProperty({ example: 'johndoe' })
  handle: string;

  @ApiProperty({ example: 'John Doe', nullable: true })
  name: string | null;

  @ApiProperty({ example: 'BASIC', enum: ['BASIC', 'VERIFIED', 'TRUSTED'] })
  verificationLevel: string;

  @ApiProperty({ example: false, description: 'Whether user has access to beta features' })
  betaAccess: boolean;

  @ApiProperty({ example: false, description: 'Whether user is a superadmin' })
  isSuperAdmin: boolean;
}

export class AuthResponseDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIs...', description: 'JWT access token' })
  accessToken: string;

  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;

  @ApiProperty({ example: 3, description: 'Number of pending email grants resolved on signup', required: false })
  resolvedGrantCount?: number;
}
