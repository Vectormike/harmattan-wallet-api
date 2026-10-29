import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { TransactionService } from './transaction.service';

@Controller('v1/transactions')
export class TransactionController {
  constructor(private readonly transactions: TransactionService) {}

  @Get(':id')
  getById(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Record<string, unknown>> {
    return this.transactions.getById(id);
  }
}
