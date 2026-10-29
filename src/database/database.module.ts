import { Global, Module } from '@nestjs/common';
import { PgPoolService } from './pg-pool.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, PgPoolService],
  exports: [PrismaService, PgPoolService],
})
export class DatabaseModule {}
