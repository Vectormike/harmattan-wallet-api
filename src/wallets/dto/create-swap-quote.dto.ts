import { Currency } from '@prisma/client';
import { IsEnum, IsString, Matches } from 'class-validator';

export class CreateSwapQuoteDto {
  @IsEnum(Currency)
  sourceCurrency!: Currency;

  @IsEnum(Currency)
  destinationCurrency!: Currency;

  @IsString()
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/, {
    message:
      'sourceAmount must be a decimal string with at most 8 decimal places',
  })
  sourceAmount!: string;
}
