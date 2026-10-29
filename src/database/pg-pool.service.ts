import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { RuntimeConfigService } from '../config/runtime-config.service';

@Injectable()
export class PgPoolService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(config: RuntimeConfigService) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: 4,
      application_name: 'harmattan-fx-locks',
    });
  }

  connect(): Promise<PoolClient> {
    return this.pool.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
