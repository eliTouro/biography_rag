import pino from 'pino';
import { cfg } from './src/config.js';
import { openDb } from './src/db.js';
import { makeLlm } from './src/llm.js';
import { createApp } from './src/app.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const db = await openDb();
// Anything left "running" by a previous process (restart, deploy) can't finish now.
await db.query(`update runs set status = 'error', error = 'The server restarted while this was running. Start it again.', finished_at = now() where status = 'running'`);
await db.query(`update documents set status = 'error', error = 'The server restarted while this file was processing. Upload it again.' where status in ('queued','extracting','embedding')`);
const llm = makeLlm();
const app = createApp({ db, llm, logger });
app.listen(cfg.port, () => logger.info({ port: cfg.port, provider: llm.provider, db: db.kind, chatModel: llm.chatModel }, 'biography-rag listening'));
