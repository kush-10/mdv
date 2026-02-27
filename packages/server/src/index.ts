#!/usr/bin/env node

import express from 'express';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import getPort, { portNumbers } from 'get-port';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WEB_DIST_PATH = path.resolve(__dirname, '../../web/dist');
const DEFAULT_PORT_RANGE = portNumbers(4173, 4300);
const TOKEN_FILE_NAME = 'server-token';

type StartConfig = {
  port?: number;
  token: string;
  tokenSource: 'env' | 'file' | 'generated';
  dataDir: string;
};

type Command =
  | { type: 'start'; options: { port?: number; dataDir: string } }
  | { type: 'token-show'; dataDir: string }
  | { type: 'token-rotate'; dataDir: string };

type PushBody = {
  fileName?: string;
  markdown?: string;
};

function printUsage(): void {
  console.error('Usage:');
  console.error('  mdv-server [--port <number>] [--data-dir <path>]');
  console.error('  mdv-server token show [--data-dir <path>]');
  console.error('  mdv-server token rotate [--data-dir <path>]');
  console.error('Optional env override: MDV_SERVER_TOKEN=<bearer-token>');
}

function parseDataDirOption(argv: string[]): string {
  const args = argv.filter((arg) => arg !== '--');
  let dataDir = path.resolve(process.cwd(), '.mdv-server-data');

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--data-dir') {
      const next = args[i + 1];
      if (!next) {
        throw new Error('Missing value for --data-dir.');
      }

      dataDir = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return dataDir;
}

function parseStartOptions(argv: string[]): { port?: number; dataDir: string } {
  const args = argv.filter((arg) => arg !== '--');
  let port: number | undefined;
  let dataDir = path.resolve(process.cwd(), '.mdv-server-data');

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '-p' || arg === '--port') {
      const next = args[i + 1];
      if (!next) {
        throw new Error('Missing value for --port.');
      }

      const parsed = Number.parseInt(next, 10);
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        throw new Error(`Invalid port: ${next}`);
      }

      port = parsed;
      i += 1;
      continue;
    }

    if (arg === '--data-dir') {
      const next = args[i + 1];
      if (!next) {
        throw new Error('Missing value for --data-dir.');
      }

      dataDir = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return {
    port,
    dataDir
  };
}

function parseCommand(argv: string[]): Command {
  const args = argv.filter((arg) => arg !== '--');

  if (args[0] === 'token') {
    if (args[1] === 'show') {
      return {
        type: 'token-show',
        dataDir: parseDataDirOption(args.slice(2))
      };
    }

    if (args[1] === 'rotate') {
      return {
        type: 'token-rotate',
        dataDir: parseDataDirOption(args.slice(2))
      };
    }

    throw new Error('Usage: mdv-server token <show|rotate> [--data-dir <path>]');
  }

  return {
    type: 'start',
    options: parseStartOptions(args)
  };
}

function getTokenFilePath(dataDir: string): string {
  return path.join(dataDir, TOKEN_FILE_NAME);
}

function generateSecureToken(): string {
  return randomBytes(32).toString('base64url');
}

async function writeTokenFile(tokenPath: string, token: string): Promise<void> {
  await fs.mkdir(path.dirname(tokenPath), { recursive: true });
  await fs.writeFile(tokenPath, `${token}\n`, { encoding: 'utf8', mode: 0o600 });

  try {
    await fs.chmod(tokenPath, 0o600);
  } catch {
    // Best effort only.
  }
}

async function resolveServerToken(dataDir: string): Promise<{ token: string; source: 'env' | 'file' | 'generated' }> {
  const envToken = process.env.MDV_SERVER_TOKEN;
  if (envToken) {
    return { token: envToken, source: 'env' };
  }

  const tokenPath = getTokenFilePath(dataDir);
  if (await fileExists(tokenPath)) {
    const token = (await fs.readFile(tokenPath, 'utf8')).trim();
    if (!token) {
      throw new Error(`Token file is empty: ${tokenPath}`);
    }

    return { token, source: 'file' };
  }

  const token = generateSecureToken();
  await writeTokenFile(tokenPath, token);
  return { token, source: 'generated' };
}

function normalizeDocumentId(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '').slice(0, 64);
}

function createDocumentId(): string {
  return randomBytes(12).toString('hex');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function assertBuildExists(): Promise<void> {
  const indexPath = path.join(WEB_DIST_PATH, 'index.html');
  if (!(await fileExists(indexPath))) {
    throw new Error(`Web build not found at ${WEB_DIST_PATH}. Run \`bun run --cwd packages/web build\` first.`);
  }
}

function printPairingInstructions(origin: string, token: string): void {
  console.log('');
  console.log('Generated new server token. Save this now:');
  console.log(`Token: ${token}`);
  console.log('Pair a client with:');
  console.log(`mdv remote pair ${origin} ${token}`);
  console.log('');
}

function parseIdFromReferer(refererHeader: string | undefined): string | null {
  if (!refererHeader) {
    return null;
  }

  try {
    const url = new URL(refererHeader);
    const match = url.pathname.match(/^\/d\/([^/]+)/);
    if (!match) {
      return null;
    }

    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

async function createUniqueDocumentId(docsDir: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = createDocumentId();
    const docPath = path.join(docsDir, `${id}.md`);
    if (!(await fileExists(docPath))) {
      return id;
    }
  }

  throw new Error('Failed to allocate unique document id.');
}

async function runStart(commandOptions: { port?: number; dataDir: string }): Promise<void> {
  const resolvedToken = await resolveServerToken(commandOptions.dataDir);
  const config: StartConfig = {
    port: commandOptions.port,
    dataDir: commandOptions.dataDir,
    token: resolvedToken.token,
    tokenSource: resolvedToken.source
  };

  await assertBuildExists();

  const docsDir = path.join(config.dataDir, 'docs');
  await fs.mkdir(docsDir, { recursive: true });

  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '5mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/push', async (req, res) => {
    const authHeader = req.get('authorization') ?? '';
    const expected = `Bearer ${config.token}`;
    if (authHeader !== expected) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const body = (req.body ?? {}) as PushBody;
    if (typeof body.markdown !== 'string') {
      res.status(400).json({ error: 'Body `markdown` must be a string.' });
      return;
    }

    const id = await createUniqueDocumentId(docsDir);
    const docPath = path.join(docsDir, `${id}.md`);

    await fs.writeFile(docPath, body.markdown, 'utf8');

    const origin = `${req.protocol}://${req.get('host')}`;
    res.json({
      id,
      url: `${origin}/d/${encodeURIComponent(id)}`
    });
  });

  app.get('/api/markdown/:id', async (req, res) => {
    const id = normalizeDocumentId(req.params.id ?? '');
    if (!id) {
      res.status(400).json({ error: 'Invalid document id.' });
      return;
    }

    const docPath = path.join(docsDir, `${id}.md`);
    try {
      const markdown = await fs.readFile(docPath, 'utf8');
      res.setHeader('x-md-path', `${id}.md`);
      res.type('text/plain; charset=utf-8').send(markdown);
    } catch {
      res.status(404).json({ error: `Document not found: ${id}` });
    }
  });

  app.get('/api/markdown', async (req, res) => {
    const fromIdQuery = typeof req.query.id === 'string' ? req.query.id : '';
    const fromLegacySlugQuery = typeof req.query.slug === 'string' ? req.query.slug : '';
    const fromReferer = parseIdFromReferer(req.get('referer'));
    const id = normalizeDocumentId(fromIdQuery || fromLegacySlugQuery || fromReferer || '');
    if (!id) {
      res.status(400).json({ error: 'Missing id. Open a public document URL at /d/<id>.' });
      return;
    }

    const docPath = path.join(docsDir, `${id}.md`);
    try {
      const markdown = await fs.readFile(docPath, 'utf8');
      res.setHeader('x-md-path', `${id}.md`);
      res.type('text/plain; charset=utf-8').send(markdown);
    } catch {
      res.status(404).json({ error: `Document not found: ${id}` });
    }
  });

  app.get('/', (_req, res) => {
    res.type('text/html; charset=utf-8').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>mdv</title>
    <style>
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; background: #f7f7f5; color: #161616; }
      main { max-width: 680px; margin: 12vh auto; padding: 0 24px; }
      h1 { margin: 0 0 12px; font-size: 2rem; }
      p { margin: 0 0 18px; line-height: 1.7; }
      a { color: inherit; }
      .hint { color: #444; font-size: 0.95rem; }
    </style>
  </head>
  <body>
    <main>
      <h1>mdv</h1>
      <p>A local-first markdown viewer with secure push to a self-hosted server for public sharing.</p>
      <p><a href="https://github.com/kush-10/mdv" target="_blank" rel="noreferrer">View on GitHub</a></p>
      <p class="hint">Published documents are available at <code>/d/&lt;id&gt;</code>.</p>
    </main>
  </body>
</html>`);
  });

  app.use(express.static(WEB_DIST_PATH, { index: false }));

  app.get('/d/:id', (_req, res) => {
    res.sendFile(path.join(WEB_DIST_PATH, 'index.html'));
  });

  app.get('/d/:id/*', (_req, res) => {
    res.sendFile(path.join(WEB_DIST_PATH, 'index.html'));
  });

  const selectedPort = config.port ?? (await getPort({ port: DEFAULT_PORT_RANGE }));
  const server = app.listen(selectedPort, () => {
    const origin = `http://localhost:${selectedPort}`;
    console.log(`mdv-server listening on ${origin}`);
    console.log(`Data dir: ${config.dataDir}`);

    if (config.tokenSource === 'env') {
      const tokenPath = getTokenFilePath(config.dataDir);
      void (async () => {
        if (!(await fileExists(tokenPath))) {
          return;
        }

        try {
          const persisted = (await fs.readFile(tokenPath, 'utf8')).trim();
          if (persisted && persisted !== config.token) {
            console.warn('Warning: MDV_SERVER_TOKEN overrides persisted token file for this run.');
          }
        } catch {
          // Best effort only.
        }
      })();
    }

    if (config.tokenSource === 'generated') {
      printPairingInstructions(origin, config.token);
    }
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    console.error(`mdv-server failed: ${error.message}`);
    process.exit(1);
  });

  let isShuttingDown = false;
  const shutdown = () => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    server.close((err?: Error) => {
      if (err) {
        console.error('Error during shutdown:', err.message);
        process.exit(1);
        return;
      }

      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function runTokenShow(dataDir: string): Promise<void> {
  const resolvedToken = await resolveServerToken(dataDir);
  console.log(resolvedToken.token);
  console.log(`Source: ${resolvedToken.source}`);
  console.log(`Token file: ${getTokenFilePath(dataDir)}`);
}

async function runTokenRotate(dataDir: string): Promise<void> {
  const tokenPath = getTokenFilePath(dataDir);
  const nextToken = generateSecureToken();
  await writeTokenFile(tokenPath, nextToken);

  console.log('Token rotated. Existing clients must pair again.');
  console.log(`New token: ${nextToken}`);
  console.log(`Token file: ${tokenPath}`);
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv.slice(2));

  if (command.type === 'start') {
    await runStart(command.options);
    return;
  }

  if (command.type === 'token-show') {
    await runTokenShow(command.dataDir);
    return;
  }

  await runTokenRotate(command.dataDir);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  printUsage();
  console.error(`mdv-server failed: ${message}`);
  process.exit(1);
});
