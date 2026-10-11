import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { DatabaseModule } from '../infra/db/database.module.js';
import { TenantResolverService } from './tenant-resolver.service.js';
import { TenantMiddleware } from './tenant.middleware.js';

@Module({
  imports: [DatabaseModule],
  providers: [TenantResolverService, TenantMiddleware],
  exports: [TenantResolverService, TenantMiddleware],
})
export class TenancyModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
