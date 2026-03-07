#!/usr/bin/env node

import express from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import getPort, { portNumbers } from 'get-port';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WEB_DIST_PATH = path.resolve(__dirname, '../../web/dist');
const DEFAULT_PORT_RANGE = portNumbers(4173, 4300);
const TOKEN_FILE_NAME = 'server-token';
const ADMIN_USERNAME_ENV = 'MDV_ADMIN_USERNAME';
const ADMIN_PASSWORD_ENV = 'MDV_ADMIN_PASSWORD';
const APP_ICON_16_URL = '/favicon-16.png';
const APP_ICON_32_URL = '/favicon-32.png';
const APP_ICON_TOUCH_URL = '/apple-touch-icon.png';

type AdminCredentials = {
  username: string;
  password: string;
};

type DocumentMetadata = {
  id: string;
  fileName: string;
  createdAt: string;
  updatedAt: string;
};

type DocumentListItem = {
  id: string;
  fileName: string;
  createdAt: string;
  updatedAt: string;
  path: string;
};

type StartConfig = {
  port?: number;
  token: string;
  tokenSource: 'env' | 'file' | 'generated';
  dataDir: string;
  admin: AdminCredentials;
};

type Command =
  | { type: 'start'; options: { port?: number; dataDir: string } }
  | { type: 'token-show'; dataDir: string }
  | { type: 'token-rotate'; dataDir: string };

type PushBody = {
  id?: string;
  fileName?: string;
  markdown?: string;
};

type PushResult = {
  id: string;
  fileName: string;
  created: boolean;
};

function printUsage(): void {
  console.error('Usage:');
  console.error('  mdv-server [--port <number>] [--data-dir <path>]');
  console.error('  mdv-server token show [--data-dir <path>]');
  console.error('  mdv-server token rotate [--data-dir <path>]');
  console.error('Optional env override: MDV_SERVER_TOKEN=<bearer-token>');
  console.error(`Required for /admin: ${ADMIN_USERNAME_ENV}=<username> ${ADMIN_PASSWORD_ENV}=<password>`);
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

function normalizeDisplayFileName(fileName: string | undefined): string {
  const fallback = 'document.md';
  if (typeof fileName !== 'string') {
    return fallback;
  }

  const normalized = path.basename(fileName).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!normalized) {
    return fallback;
  }

  return normalized.slice(0, 200);
}

function getDocumentPath(docsDir: string, id: string): string {
  return path.join(docsDir, `${id}.md`);
}

function getMetadataPath(docsDir: string, id: string): string {
  return path.join(docsDir, `${id}.json`);
}

function toIsoStringFromTimeMs(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return new Date().toISOString();
  }

  return new Date(value).toISOString();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hashSecret(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function secureCompare(left: string, right: string): boolean {
  return timingSafeEqual(hashSecret(left), hashSecret(right));
}

function decodeBasicAuthorization(value: string): { username: string; password: string } | null {
  if (!value.startsWith('Basic ')) {
    return null;
  }

  const encoded = value.slice(6).trim();
  if (!encoded) {
    return null;
  }

  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex <= 0) {
      return null;
    }

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1)
    };
  } catch {
    return null;
  }
}

function resolveAdminCredentials(): AdminCredentials {
  const username = (process.env[ADMIN_USERNAME_ENV] ?? '').trim();
  const password = process.env[ADMIN_PASSWORD_ENV] ?? '';

  if (!username || !password) {
    throw new Error(
      `Missing admin credentials. Set both ${ADMIN_USERNAME_ENV} and ${ADMIN_PASSWORD_ENV} environment variables.`
    );
  }

  return { username, password };
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

async function writeDocumentMetadata(docsDir: string, metadata: DocumentMetadata): Promise<void> {
  const metadataPath = getMetadataPath(docsDir, metadata.id);
  await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

async function readDocumentMetadata(docsDir: string, id: string): Promise<DocumentMetadata | null> {
  const metadataPath = getMetadataPath(docsDir, id);
  if (!(await fileExists(metadataPath))) {
    return null;
  }

  try {
    const raw = await fs.readFile(metadataPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DocumentMetadata>;
    const fileName = normalizeDisplayFileName(parsed.fileName);
    const createdAt = typeof parsed.createdAt === 'string' && parsed.createdAt ? parsed.createdAt : '';
    const updatedAt = typeof parsed.updatedAt === 'string' && parsed.updatedAt ? parsed.updatedAt : '';

    return {
      id,
      fileName,
      createdAt: createdAt || new Date().toISOString(),
      updatedAt: updatedAt || createdAt || new Date().toISOString()
    };
  } catch {
    return null;
  }
}

async function listDocuments(docsDir: string): Promise<DocumentListItem[]> {
  const entries = await fs.readdir(docsDir, { withFileTypes: true });
  const markdownEntries = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md'));

  const documents = await Promise.all(
    markdownEntries.map(async (entry) => {
      const id = entry.name.slice(0, -3);
      const docPath = getDocumentPath(docsDir, id);
      const stats = await fs.stat(docPath);
      const metadata = await readDocumentMetadata(docsDir, id);
      const fallbackCreatedAt = toIsoStringFromTimeMs(stats.birthtimeMs || stats.ctimeMs);
      const fallbackUpdatedAt = toIsoStringFromTimeMs(stats.mtimeMs);

      return {
        id,
        fileName: metadata?.fileName ?? `${id}.md`,
        createdAt: metadata?.createdAt ?? fallbackCreatedAt,
        updatedAt: metadata?.updatedAt ?? fallbackUpdatedAt,
        path: `/d/${encodeURIComponent(id)}`
      } satisfies DocumentListItem;
    })
  );

  documents.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  return documents;
}

async function readMarkdownWithDisplayName(
  docsDir: string,
  id: string
): Promise<{ markdown: string; displayFileName: string }> {
  const docPath = getDocumentPath(docsDir, id);
  const [markdown, metadata] = await Promise.all([
    fs.readFile(docPath, 'utf8'),
    readDocumentMetadata(docsDir, id)
  ]);

  return {
    markdown,
    displayFileName: metadata?.fileName ?? `${id}.md`
  };
}

async function writePushedDocument(
  docsDir: string,
  markdown: string,
  fileName: string | undefined,
  requestedId: string
): Promise<PushResult> {
  const normalizedFileName = normalizeDisplayFileName(fileName);
  const now = new Date().toISOString();

  if (requestedId) {
    const existingDocPath = getDocumentPath(docsDir, requestedId);
    if (await fileExists(existingDocPath)) {
      const existingMetadata = await readDocumentMetadata(docsDir, requestedId);
      let createdAt = existingMetadata?.createdAt ?? now;

      if (!existingMetadata) {
        try {
          const stats = await fs.stat(existingDocPath);
          createdAt = toIsoStringFromTimeMs(stats.birthtimeMs || stats.ctimeMs);
        } catch {
          createdAt = now;
        }
      }

      const updatedMetadata: DocumentMetadata = {
        id: requestedId,
        fileName: normalizedFileName,
        createdAt,
        updatedAt: now
      };

      await Promise.all([
        fs.writeFile(existingDocPath, markdown, 'utf8'),
        writeDocumentMetadata(docsDir, updatedMetadata)
      ]);

      return {
        id: requestedId,
        fileName: normalizedFileName,
        created: false
      };
    }
  }

  const id = await createUniqueDocumentId(docsDir);
  const docPath = getDocumentPath(docsDir, id);
  const metadata: DocumentMetadata = {
    id,
    fileName: normalizedFileName,
    createdAt: now,
    updatedAt: now
  };

  await Promise.all([
    fs.writeFile(docPath, markdown, 'utf8'),
    writeDocumentMetadata(docsDir, metadata)
  ]);

  return {
    id,
    fileName: normalizedFileName,
    created: true
  };
}

async function deleteDocument(docsDir: string, id: string): Promise<boolean> {
  const docPath = getDocumentPath(docsDir, id);
  if (!(await fileExists(docPath))) {
    return false;
  }

  await Promise.all([
    fs.rm(docPath),
    fs.rm(getMetadataPath(docsDir, id), { force: true })
  ]);

  return true;
}

function createAdminAuthMiddleware(admin: AdminCredentials): express.RequestHandler {
  return (req, res, next) => {
    const credentials = decodeBasicAuthorization(req.get('authorization') ?? '');
    const isAuthorized =
      credentials !== null &&
      secureCompare(credentials.username, admin.username) &&
      secureCompare(credentials.password, admin.password);

    if (!isAuthorized) {
      res.setHeader('www-authenticate', 'Basic realm="mdv admin", charset="UTF-8"');
      res.setHeader('cache-control', 'no-store');
      res.status(401).send('Unauthorized');
      return;
    }

    next();
  };
}

async function runStart(commandOptions: { port?: number; dataDir: string }): Promise<void> {
  const resolvedToken = await resolveServerToken(commandOptions.dataDir);
  const admin = resolveAdminCredentials();
  const config: StartConfig = {
    port: commandOptions.port,
    dataDir: commandOptions.dataDir,
    token: resolvedToken.token,
    tokenSource: resolvedToken.source,
    admin
  };

  await assertBuildExists();

  const docsDir = path.join(config.dataDir, 'docs');
  await fs.mkdir(docsDir, { recursive: true });

  const app = express();
  const requireAdminAuth = createAdminAuthMiddleware(config.admin);
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

    const requestedId = typeof body.id === 'string' ? normalizeDocumentId(body.id) : '';
    if (typeof body.id === 'string' && !requestedId) {
      res.status(400).json({ error: 'Body `id` must be a valid document id.' });
      return;
    }

    let pushResult: PushResult;
    try {
      pushResult = await writePushedDocument(
        docsDir,
        body.markdown,
        body.fileName,
        requestedId
      );
    } catch {
      res.status(500).json({ error: 'Failed to persist markdown document.' });
      return;
    }

    const origin = `${req.protocol}://${req.get('host')}`;
    res.json({
      id: pushResult.id,
      fileName: pushResult.fileName,
      created: pushResult.created,
      url: `${origin}/d/${encodeURIComponent(pushResult.id)}`
    });
  });

  app.get('/api/markdown/:id', async (req, res) => {
    const id = normalizeDocumentId(req.params.id ?? '');
    if (!id) {
      res.status(400).json({ error: 'Invalid document id.' });
      return;
    }

    try {
      const document = await readMarkdownWithDisplayName(docsDir, id);
      res.setHeader('x-md-path', document.displayFileName);
      res.type('text/plain; charset=utf-8').send(document.markdown);
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

    try {
      const document = await readMarkdownWithDisplayName(docsDir, id);
      res.setHeader('x-md-path', document.displayFileName);
      res.type('text/plain; charset=utf-8').send(document.markdown);
    } catch {
      res.status(404).json({ error: `Document not found: ${id}` });
    }
  });

  app.get('/api/admin/files', requireAdminAuth, async (req, res) => {
    try {
      const documents = await listDocuments(docsDir);
      res.setHeader('cache-control', 'no-store');
      res.json({
        files: documents
      });
    } catch {
      res.status(500).json({ error: 'Failed to list files.' });
    }
  });

  app.delete('/api/admin/files/:id', requireAdminAuth, async (req, res) => {
    const id = normalizeDocumentId(typeof req.params.id === 'string' ? req.params.id : '');
    if (!id) {
      res.status(400).json({ error: 'Invalid document id.' });
      return;
    }

    try {
      const wasDeleted = await deleteDocument(docsDir, id);
      if (!wasDeleted) {
        res.status(404).json({ error: `Document not found: ${id}` });
        return;
      }

      res.json({ ok: true, id });
    } catch {
      res.status(500).json({ error: 'Failed to delete file.' });
    }
  });

  app.post('/admin/files/:id/delete', requireAdminAuth, async (req, res) => {
    const id = normalizeDocumentId(typeof req.params.id === 'string' ? req.params.id : '');
    if (!id) {
      res.redirect(303, '/admin?status=invalid-id');
      return;
    }

    try {
      const wasDeleted = await deleteDocument(docsDir, id);
      if (!wasDeleted) {
        res.redirect(303, '/admin?status=not-found');
        return;
      }

      res.redirect(303, `/admin?status=deleted&id=${encodeURIComponent(id)}`);
    } catch {
      res.redirect(303, '/admin?status=delete-error');
    }
  });

  app.get('/admin', requireAdminAuth, async (req, res) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : '';
      const statusId = typeof req.query.id === 'string' ? normalizeDocumentId(req.query.id) : '';
      const documents = await listDocuments(docsDir);
      const statusMessage =
        status === 'deleted' && statusId
          ? `<p class="notice success">Deleted document <code>${escapeHtml(statusId)}</code>.</p>`
          : status === 'not-found'
            ? '<p class="notice error">Document not found. It may have already been deleted.</p>'
            : status === 'invalid-id'
              ? '<p class="notice error">Invalid document id.</p>'
              : status === 'delete-error'
                ? '<p class="notice error">Failed to delete document.</p>'
                : '';
      const rows =
        documents.length === 0
          ? '<tr><td colspan="5" class="empty">No files uploaded yet.</td></tr>'
          : documents
              .map((document) => {
                const deletePath = `/admin/files/${encodeURIComponent(document.id)}/delete`;
                return `<tr>
      <td><a href="${escapeHtml(document.path)}">${escapeHtml(document.fileName)}</a></td>
      <td><code>${escapeHtml(document.id)}</code></td>
      <td>${escapeHtml(new Date(document.createdAt).toLocaleString())}</td>
      <td>${escapeHtml(new Date(document.updatedAt).toLocaleString())}</td>
      <td class="actions">
        <form method="post" action="${escapeHtml(deletePath)}" onsubmit="return window.confirm('Delete this page permanently?');">
          <button type="submit" class="danger">Delete</button>
        </form>
      </td>
    </tr>`;
              })
              .join('\n');

      res.setHeader('cache-control', 'no-store');
      res.type('text/html; charset=utf-8').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/png" sizes="16x16" href="${escapeHtml(APP_ICON_16_URL)}" />
    <link rel="icon" type="image/png" sizes="32x32" href="${escapeHtml(APP_ICON_32_URL)}" />
    <link rel="shortcut icon" type="image/png" href="${escapeHtml(APP_ICON_32_URL)}" />
    <link rel="apple-touch-icon" href="${escapeHtml(APP_ICON_TOUCH_URL)}" />
    <title>mdv admin</title>
    <style>
      :root { color-scheme: light dark; }
      body { margin: 0; padding: 40px 20px; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; }
      main { max-width: 980px; margin: 0 auto; }
      h1 { margin: 0 0 8px; }
      p { margin: 0 0 20px; }
      .notice { margin: 0 0 18px; padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(127, 127, 127, 0.45); }
      .notice.success { border-color: rgba(15, 140, 74, 0.55); }
      .notice.error { border-color: rgba(168, 34, 34, 0.6); }
      .token-panel { margin: 0 0 20px; padding: 12px 14px; border: 1px solid rgba(127, 127, 127, 0.35); border-radius: 8px; }
      .token-panel p { margin: 0 0 8px; }
      .token-panel p:last-child { margin-bottom: 0; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid rgba(127, 127, 127, 0.35); }
      th:last-child, td:last-child { text-align: right; }
      .actions form { margin: 0; }
      .danger { border: 1px solid rgba(168, 34, 34, 0.7); border-radius: 8px; background: transparent; color: inherit; padding: 6px 10px; cursor: pointer; }
      .danger:hover { background: rgba(168, 34, 34, 0.16); }
      code { font-size: 0.9em; }
      .empty { color: #666; text-align: center; }
    </style>
  </head>
  <body>
    <main>
      <h1>mdv admin</h1>
      <p>Uploaded files: ${documents.length}</p>
      ${statusMessage}
      <section class="token-panel" aria-label="Server token">
        <p>Server token: <code>${escapeHtml(config.token)}</code></p>
        <p>Source: <code>${escapeHtml(config.tokenSource)}</code></p>
      </section>
      <table>
        <thead>
          <tr>
            <th>File name</th>
            <th>ID</th>
            <th>Created</th>
            <th>Updated</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </main>
  </body>
</html>`);
    } catch {
      res.status(500).type('text/plain; charset=utf-8').send('Failed to render admin page.');
    }
  });

  app.get('/', (_req, res) => {
    res.type('text/html; charset=utf-8').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/png" sizes="16x16" href="${escapeHtml(APP_ICON_16_URL)}" />
    <link rel="icon" type="image/png" sizes="32x32" href="${escapeHtml(APP_ICON_32_URL)}" />
    <link rel="shortcut icon" type="image/png" href="${escapeHtml(APP_ICON_32_URL)}" />
    <link rel="apple-touch-icon" href="${escapeHtml(APP_ICON_TOUCH_URL)}" />
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
  const server = app.listen(selectedPort, '0.0.0.0', () => {
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
