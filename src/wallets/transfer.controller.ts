import { Body, Controller, Headers, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { requireIdempotencyKey } from '../common/idempotency-key';
import { TransferDto } from './dto/transfer.dto';
import { TransferService } from './transfer.service';

@Controller('v1/transfers')
export class TransferController {
  constructor(private readonly transfers: TransferService) {}

  @Post()
  async transfer(
    @Body() dto: TransferDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown>> {
    const result = await this.transfers.transfer(
      dto,
      requireIdempotencyKey(key),
    );
    response.status(result.status);
    if (result.replayed) response.setHeader('Idempotency-Replayed', 'true');
    return result.body;
  }
}
