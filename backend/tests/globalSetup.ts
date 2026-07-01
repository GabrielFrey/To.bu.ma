import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = join(here, '..', 'prisma', 'test.db');

/** Create a fresh SQLite schema for the test run. */
export default function setup() {
  if (existsSync(dbPath)) rmSync(dbPath);
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: join(here, '..'),
    env: { ...process.env, DATABASE_URL: 'file:./test.db' },
    stdio: 'ignore',
  });
}
