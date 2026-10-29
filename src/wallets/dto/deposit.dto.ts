import { Currency } from '@prisma/client';
import { IsEnum, IsString, Matches } from 'class-validator';

export class DepositDto {
  @IsEnum(Currency)
  currency!: Currency;

  @IsString()
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/, {
    message: 'amount must be a decimal string with at most 8 decimal places',
  })
  amount!: string;
}
