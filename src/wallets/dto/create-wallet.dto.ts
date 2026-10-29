import { IsEmail, IsOptional, Matches, MaxLength } from 'class-validator';

export class CreateWalletDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @IsOptional()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'mobile must use E.164 format, for example +2348012345678',
  })
  mobile?: string;
}
