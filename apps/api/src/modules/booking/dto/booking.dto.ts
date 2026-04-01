import { IsString, IsBoolean, IsOptional, IsIn, IsNumber, IsArray } from 'class-validator';

export class SetContactTierDto {
  @IsOptional()
  @IsString()
  contactHandle?: string;

  @IsOptional()
  @IsString()
  contactEmail?: string;

  @IsIn(['direct', 'approval', 'blocked'])
  tier: 'direct' | 'approval' | 'blocked';
}

export class SetDefaultTierDto {
  @IsBoolean()
  autoApprove: boolean;
}

export class UpdateBookingProfileByKeyDto {
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  durations?: number[];

  @IsOptional()
  @IsNumber()
  bufferBefore?: number;

  @IsOptional()
  @IsNumber()
  bufferAfter?: number;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
