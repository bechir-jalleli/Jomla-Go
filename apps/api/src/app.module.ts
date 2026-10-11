import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

import { DatabaseModule } from './infra/db/database.module.js';
import { TenancyModule } from './tenancy/tenancy.module.js';

@Module({
  imports: [DatabaseModule, TenancyModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
