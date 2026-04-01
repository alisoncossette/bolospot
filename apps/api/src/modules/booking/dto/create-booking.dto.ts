import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
} from 'class-validator';

export class CreateBookingDto {
  @IsString()
  startTime: string;

  @IsNumber()
  duration: number;

  @IsString()
  timezone: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  additionalAttendees?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  additionalHandles?: string[];

  @IsOptional()
  @IsString()
  profileSlug?: string;
}
