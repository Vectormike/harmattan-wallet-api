import { IsUUID } from 'class-validator';

export class ExecuteSwapDto {
  @IsUUID()
  quoteId!: string;
}
