import { IsBoolean } from 'class-validator';

export class ToggleSelectedDto {
  @IsBoolean()
  isSelected: boolean;
}

export class ToggleBusyBlockDto {
  @IsBoolean()
  isBusyBlock: boolean;
}
