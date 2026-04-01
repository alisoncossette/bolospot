import { IsString } from 'class-validator';

export class QuickLoginDto {
  @IsString()
  email: string;
}
