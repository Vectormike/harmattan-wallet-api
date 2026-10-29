import { Controller, Get } from '@nestjs/common';
import { FxService } from './fx.service';

@Controller('v1/rates')
export class FxController {
  constructor(private readonly fxService: FxService) {}

  @Get()
  getRates(): Promise<Record<string, unknown>> {
    return this.fxService.ratesResponse();
  }
}
