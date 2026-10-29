import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error';
import { serializeTransaction } from '../common/serializers';
import { TransactionRepository } from './transaction.repository';

@Injectable()
export class TransactionService {
  constructor(private readonly transactions: TransactionRepository) {}

  async getById(id: string): Promise<Record<string, unknown>> {
    const transaction = await this.transactions.findById(id);
    if (!transaction) {
      throw new ApiError(
        HttpStatus.NOT_FOUND,
        'TRANSACTION_NOT_FOUND',
        'Transaction was not found',
      );
    }
    return serializeTransaction(transaction);
  }
}
