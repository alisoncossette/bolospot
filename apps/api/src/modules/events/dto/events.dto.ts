import { IsString } from 'class-validator';

export class UpdateEventDto {
  @IsString()
  calendarId: string;

  @IsString()
  startTime: string;

  @IsString()
  endTime: string;
}
