import { Module } from '@nestjs/common';
import { FxController } from './fx.controller';
import { FxService } from './fx.service';
import { FxSnapshotRepository } from './fx-snapshot.repository';

@Module({
  controllers: [FxController],
  providers: [FxService, FxSnapshotRepository],
  exports: [FxService, FxSnapshotRepository],
})
export class FxModule {}
