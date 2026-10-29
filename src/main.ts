import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { AppModule } from './app.module';
import { RuntimeConfigService } from './config/runtime-config.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  const config = app.get(RuntimeConfigService);
  await app.listen(config.port, '0.0.0.0');
}

void bootstrap();
