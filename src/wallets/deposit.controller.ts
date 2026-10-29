import {
  Body,
  Controller,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { requireIdempotencyKey } from '../common/idempotency-key';
import { DepositService } from './deposit.service';
import { DepositDto } from './dto/deposit.dto';

@Controller('v1/wallets/:walletId/deposits')
export class DepositController {
  constructor(private readonly deposits: DepositService) {}

  @Post()
  async deposit(
    @Param('walletId', new ParseUUIDPipe()) walletId: string,
    @Body() dto: DepositDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown>> {
    const result = await this.deposits.deposit(
      walletId,
      dto,
      requireIdempotencyKey(key),
    );
    response.status(result.status);
    if (result.replayed) response.setHeader('Idempotency-Replayed', 'true');
    return result.body;
  }
}
