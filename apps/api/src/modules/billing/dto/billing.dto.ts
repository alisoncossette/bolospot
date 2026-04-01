import { IsIn } from 'class-validator';

export class CreateCheckoutDto {
  @IsIn(['PRO', 'BUILDER'])
  plan: 'PRO' | 'BUILDER';
}
