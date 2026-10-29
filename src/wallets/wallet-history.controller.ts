import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { HistoryQueryDto } from './dto/history-query.dto';
import { WalletHistoryService } from './wallet-history.service';

@Controller('v1/wallets/:walletId/transactions')
export class WalletHistoryController {
  constructor(private readonly history: WalletHistoryService) {}

  @Get()
  get(
    @Param('walletId', new ParseUUIDPipe()) walletId: string,
    @Query() query: HistoryQueryDto,
  ): Promise<Record<string, unknown>> {
    return this.history.get(walletId, query);
  }
}
