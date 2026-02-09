import { Global, Module } from '@nestjs/common';
import { type NodePgDatabase, drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

export const DATABASE = Symbol('DATABASE');
export type Database = NodePgDatabase;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://worken:worken@localhost:5432/worken',
});

const db: Database = drizzle(pool);

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      useValue: db,
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule {}
