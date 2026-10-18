// Carga .env.local / .env para los scripts de línea de comandos (Next.js lo hace solo para la app).
import fs from 'node:fs';

for (const f of ['.env.local', '.env']) if (fs.existsSync(f)) process.loadEnvFile(f);
