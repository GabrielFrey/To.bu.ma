// Generate a Postgres-targeted Prisma schema from the canonical SQLite schema by
// swapping only the datasource provider. Keeps a single source of truth
// (schema.prisma) and avoids drift between the SQLite (local) and Postgres
// (Docker/prod) targets. Output is gitignored and produced at build time.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'prisma', 'schema.prisma');
const out = join(here, '..', 'prisma', 'schema.postgres.prisma');

const schema = readFileSync(src, 'utf8').replace(
  /datasource db \{\s*provider = "sqlite"/,
  'datasource db {\n  provider = "postgresql"'
);

if (!schema.includes('provider = "postgresql"')) {
  console.error('Failed to rewrite datasource provider to postgresql');
  process.exit(1);
}

writeFileSync(out, `// AUTO-GENERATED from schema.prisma — do not edit. Run: npm run schema:pg\n${schema}`);
console.log(`Wrote ${out}`);
