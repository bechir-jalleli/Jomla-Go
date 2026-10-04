import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  if (process.env.NODE_ENV === 'production') {
    console.error('db:reset cannot run in production');
    process.exit(1);
  }

  const migratorUrl = process.env.DATABASE_MIGRATOR_URL;
  if (!migratorUrl || (!migratorUrl.includes('localhost') && !migratorUrl.includes('127.0.0.1'))) {
    console.error('db:reset can only run against localhost/127.0.0.1');
    process.exit(1);
  }

  // Connect as superuser to drop and recreate the DB
  const adminUrl = `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@localhost:5433/postgres`;
  const dbName = process.env.POSTGRES_DB;

  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();

  console.log(`Dropping and recreating database ${dbName}...`);
  // Terminate other connections before dropping
  await client.query(`
    SELECT pg_terminate_backend(pg_stat_activity.pid)
    FROM pg_stat_activity
    WHERE pg_stat_activity.datname = $1
      AND pid <> pg_backend_pid();
  `, [dbName]);

  await client.query(`DROP DATABASE IF EXISTS "${dbName}"`);
  await client.query(`CREATE DATABASE "${dbName}" OWNER app_owner`);
  await client.end();

  // Apply privileges
  console.log('Applying privileges...');
  const privSql = fs.readFileSync(path.join(__dirname, '../../../infra/postgres/init/02-privileges.sql'), 'utf-8');
  
  const superuserDbClient = new pg.Client({ connectionString: `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@localhost:5433/${dbName}` });
  await superuserDbClient.connect();
  await superuserDbClient.query(privSql);
  await superuserDbClient.end();

  // Run migrations
  console.log('Running migrations...');
  execSync('npm run db:migrate', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  
  console.log('Reset complete.');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
