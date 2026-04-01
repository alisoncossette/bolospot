import { IsIn, IsOptional, IsString } from 'class-validator';

export class RespondToApprovalDto {
  @IsIn(['APPROVED', 'DENIED'])
  status: 'APPROVED' | 'DENIED';

  @IsOptional()
  @IsString()
  responseNote?: string;
}
