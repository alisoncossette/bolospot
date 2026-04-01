import { IsString, IsBoolean, IsArray } from 'class-validator';

export class SetBetaAccessDto {
  @IsString()
  handle: string;

  @IsBoolean()
  betaAccess: boolean;
}

export class SetBetaAccessBulkDto {
  @IsArray()
  @IsString({ each: true })
  handles: string[];

  @IsBoolean()
  betaAccess: boolean;
}
