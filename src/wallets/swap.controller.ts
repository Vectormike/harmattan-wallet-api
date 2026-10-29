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
import { CreateSwapQuoteDto } from './dto/create-swap-quote.dto';
import { ExecuteSwapDto } from './dto/execute-swap.dto';
import { SwapQuoteService } from './swap-quote.service';
import { SwapService } from './swap.service';

@Controller('v1/wallets/:walletId/swaps')
export class SwapController {
  constructor(
    private readonly quotes: SwapQuoteService,
    private readonly swaps: SwapService,
  ) {}

  @Post('quotes')
  createQuote(
    @Param('walletId', new ParseUUIDPipe()) walletId: string,
    @Body() dto: CreateSwapQuoteDto,
  ): Promise<Record<string, unknown>> {
    return this.quotes.create(walletId, dto);
  }

  @Post()
  async execute(
    @Param('walletId', new ParseUUIDPipe()) walletId: string,
    @Body() dto: ExecuteSwapDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown>> {
    const result = await this.swaps.execute(
      walletId,
      dto,
      requireIdempotencyKey(key),
    );
    response.status(result.status);
    if (result.replayed) response.setHeader('Idempotency-Replayed', 'true');
    return result.body;
  }
}
