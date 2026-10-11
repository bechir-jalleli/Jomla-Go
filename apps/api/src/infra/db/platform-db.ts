import { Injectable, Inject } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import * as schema from '@repo/db';

export const PLATFORM_PG_POOL = Symbol('PLATFORM_PG_POOL');
export const RUNTIME_PG_POOL = Symbol('RUNTIME_PG_POOL');

@Injectable()
export class PlatformDb {
  public readonly db: NodePgDatabase<typeof schema>;

  constructor(@Inject(PLATFORM_PG_POOL) private readonly pool: pg.Pool) {
    this.db = drizzle(this.pool, { schema });
  }

  get query() {
    return this.db.query;
  }

  get select() {
    return this.db.select.bind(this.db);
  }

  get insert() {
    return this.db.insert.bind(this.db);
  }

  get update() {
    return this.db.update.bind(this.db);
  }

  get delete() {
    return this.db.delete.bind(this.db);
  }
}
