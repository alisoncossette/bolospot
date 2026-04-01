import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  IsBoolean,
  IsIn,
} from 'class-validator';

export class CreateMeetingDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  duration: number;

  @IsString()
  dateRangeStart: string;

  @IsString()
  dateRangeEnd: string;

  @IsString()
  timezone: string;

  @IsOptional()
  @IsNumber()
  timeRangeStart?: number;

  @IsOptional()
  @IsNumber()
  timeRangeEnd?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  participantEmails?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  participantHandles?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  participantPhones?: string[];

  @IsOptional()
  @IsString()
  recordingPolicy?: string;

  @IsOptional()
  @IsString()
  preferredConnectionId?: string;

  @IsOptional()
  @IsBoolean()
  createVideoConference?: boolean;

  @IsOptional()
  @IsString()
  workflow?: string;
}

export class BookMeetingDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  startTime: string;

  @IsString()
  endTime: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  participantHandles?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  participantEmails?: string[];

  @IsOptional()
  @IsString()
  location?: string;
}

export class RespondToInvitationDto {
  @IsIn(['APPROVED', 'DECLINED'])
  response: 'APPROVED' | 'DECLINED';
}

export class ConfirmMeetingDto {
  @IsString()
  startTime: string;

  @IsString()
  endTime: string;

  @IsOptional()
  @IsString()
  meetingLink?: string;
}

export class UpdateMeetingRangeDto {
  @IsOptional()
  @IsString()
  dateRangeStart?: string;

  @IsOptional()
  @IsString()
  dateRangeEnd?: string;

  @IsOptional()
  @IsNumber()
  timeRangeStart?: number;

  @IsOptional()
  @IsNumber()
  timeRangeEnd?: number;
}

export class RequestHoursOverrideDto {
  @IsString()
  targetUserId: string;

  @IsNumber()
  requestedStart: number;

  @IsNumber()
  requestedEnd: number;

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  requestedDays?: number[];

  @IsOptional()
  @IsString()
  reason?: string;
}

export class RespondToHoursOverrideDto {
  @IsIn(['APPROVED', 'DECLINED'])
  response: 'APPROVED' | 'DECLINED';

  @IsOptional()
  @IsString()
  responseNote?: string;
}
