// Uso: node db/cli.js migrate | seed | reset
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../server/config.js';
import { openDb, migrate } from '../server/db.js';
import { seed } from './seed.js';

const cmd = process.argv[2];
if (!['migrate', 'seed', 'reset'].includes(cmd)) { console.log('Uso: node db/cli.js migrate | seed | reset'); process.exit(1); }

if (cmd === 'reset') {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(config.dbPath + suffix, { force: true });
  fs.rmSync(path.join(config.uploadsDir, 'logos'), { recursive: true, force: true });
  console.log('Base de datos eliminada.');
}

const db = openDb();
const applied = migrate(db);
console.log(applied.length ? `Migraciones aplicadas: ${applied.join(', ')}` : 'Esquema al día.');
if (cmd !== 'migrate') seed(db);
db.close();
