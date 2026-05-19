#!/usr/bin/env node

import express from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import getPort, { portNumbers } from 'get-port';
import { renderMarkdownToPdf } from './pdf.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WEB_DIST_PATH = path.resolve(__dirname, '../../web/dist');
const DEFAULT_PORT_RANGE = portNumbers(4173, 4300);
const TOKEN_FILE_NAME = 'server-token';
const ADMIN_USERNAME_ENV = 'MDV_ADMIN_USERNAME';
const ADMIN_PASSWORD_ENV = 'MDV_ADMIN_PASSWORD';
const PUSH_JSON_BODY_LIMIT = '25mb';
const MAX_PUSH_ASSET_COUNT = 256;
const MAX_PUSH_ASSET_BYTES = 20 * 1024 * 1024;
const APP_ICON_16_URL = '/favicon-16.png';
const APP_ICON_32_URL = '/favicon-32.png';
const APP_ICON_TOUCH_URL = '/apple-touch-icon.png';
const REPOSITORY_URL = 'https://github.com/kush-10/mdv';
const PAGE_NOT_FOUND_MESSAGE = 'Page not found. Check the URL, or sign in via /admin if this is a private page.';
const UNFILED_FOLDER_LABEL = 'Unfiled';

type AdminCredentials = {
  username: string;
  password: string;
};

type DocumentVisibility = 'private' | 'pinned';

type DocumentMetadata = {
  id: string;
  fileName: string;
  createdAt: string;
  updatedAt: string;
  visibility: DocumentVisibility;
  folder: string;
};

type DocumentListItem = {
  id: string;
  fileName: string;
  createdAt: string;
  updatedAt: string;
  visibility: DocumentVisibility;
  folder: string;
  path: string;
};

type FolderListItem = {
  name: string;
  displayName: string;
  path: string;
  total: number;
  pinnedCount: number;
  privateCount: number;
  updatedAt: string;
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
  visibility?: string;
  assets?: PushAssetBody[];
};

type PushAssetBody = {
  path?: unknown;
  dataBase64?: unknown;
};

type PushAsset = {
  path: string;
  data: Buffer;
};

type PushResult = {
  id: string;
  fileName: string;
  created: boolean;
};

type DocumentMetadataRecord = {
  metadata: DocumentMetadata;
  shouldRewrite: boolean;
};

type UiIconName = 'pin' | 'lock' | 'share' | 'bin' | 'link' | 'download' | 'folder' | 'admin';

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

function normalizeFolderName(folderName: unknown): string {
  if (typeof folderName !== 'string') {
    return '';
  }

  return folderName
    .replace(/[\u0000-\u001f\u007f/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function getFolderDisplayName(folderName: string): string {
  return folderName || UNFILED_FOLDER_LABEL;
}

function getFolderPath(folderName: string): string {
  return folderName ? `/folders/${encodeURIComponent(folderName)}` : '/folders';
}

function isDocumentVisibility(value: string): value is DocumentVisibility {
  return value === 'private' || value === 'pinned';
}

function normalizeDocumentVisibility(value: unknown): DocumentVisibility {
  return value === 'pinned' ? 'pinned' : 'private';
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

function getOrdinalDayLabel(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${day}th`;
  }

  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

function formatUkDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  const day = getOrdinalDayLabel(parsed.getDate());
  const month = parsed.toLocaleString('en-GB', { month: 'short' });
  const year = String(parsed.getFullYear()).slice(-2);
  const hours = String(parsed.getHours()).padStart(2, '0');
  const minutes = String(parsed.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${year} ${hours}:${minutes}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderUiIcon(name: UiIconName): string {
  const shapes: Record<UiIconName, string> = {
    pin: '<path d="M7 3.9h6l-1 4 2.4 2V11H5.6V9.9L8 7.9l-1-4Z" /><path d="M10 11v5.1" />',
    lock: '<path d="M7.1 9V7a2.9 2.9 0 0 1 5.8 0v2" /><rect x="5.4" y="9" width="9.2" height="7.5" rx="1.4" />',
    share: '<circle cx="15.2" cy="4.7" r="1.9" /><circle cx="4.8" cy="10" r="1.9" /><circle cx="15.2" cy="15.3" r="1.9" /><path d="m6.5 9.1 6.9-3.4" /><path d="m6.5 10.9 6.9 3.4" />',
    bin: '<path d="M4.8 5.5h10.4" /><path d="m7.4 5.5.4-1.5h4.4l.4 1.5" /><rect x="6" y="5.5" width="8" height="10.3" rx="1.2" /><path d="M8.8 8.2v5" /><path d="M11.2 8.2v5" />',
    link: '<path d="m7.5 12.5-1.9 1.9a2.8 2.8 0 1 1-4-4l1.9-1.9a2.8 2.8 0 0 1 4 0" /><path d="m12.5 7.5 1.9-1.9a2.8 2.8 0 0 1 4 4l-1.9 1.9a2.8 2.8 0 0 1-4 0" /><path d="M7.7 12.3 12.3 7.7" />',
    download: '<path d="M10 3.7v8.1" /><path d="m6.8 8.9 3.2 3.2 3.2-3.2" /><path d="M4.7 15.8h10.6" />',
    folder: '<path d="M3.6 6.1h5l1.4 1.7h6.4v7.4a1.5 1.5 0 0 1-1.5 1.5H5.1a1.5 1.5 0 0 1-1.5-1.5V6.1Z" /><path d="M3.6 8.1h12.8" />',
    admin: '<circle cx="10" cy="7" r="3" /><path d="M4.8 16.2a5.3 5.3 0 0 1 10.4 0" />'
  };

  return `<svg viewBox="0 0 20 20" class="ui-icon" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${shapes[name]}</svg>`;
}

function renderGithubIcon(): string {
  return '<svg viewBox="-1 -1 18 18" class="ui-icon" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path fill="currentColor" stroke="none" d="M8 0a8 8 0 0 0-2.53 15.59c.4.08.55-.17.55-.38l-.01-1.35c-2.02.44-2.54-.5-2.7-.95a2.15 2.15 0 0 0-.9-1.18c-.3-.16-.73-.56 0-.57.68-.01 1.16.62 1.32.87.78 1.32 2.03.95 2.53.72.08-.57.3-.95.55-1.16-1.8-.2-3.68-.9-3.68-4a3.14 3.14 0 0 1 .83-2.18 2.9 2.9 0 0 1 .08-2.15s.67-.21 2.2.83a7.55 7.55 0 0 1 4 0c1.53-1.04 2.2-.83 2.2-.83.3.75.33 1.57.08 2.15a3.12 3.12 0 0 1 .83 2.18c0 3.11-1.9 3.79-3.7 3.99.3.26.56.77.56 1.56l-.01 2.3c0 .21.14.46.55.38A8 8 0 0 0 8 0Z" /></svg>';
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

function isAuthorizedAdminRequest(req: express.Request, admin: AdminCredentials): boolean {
  const credentials = decodeBasicAuthorization(req.get('authorization') ?? '');
  return (
    credentials !== null &&
    secureCompare(credentials.username, admin.username) &&
    secureCompare(credentials.password, admin.password)
  );
}

function canAccessDocument(req: express.Request, metadata: DocumentMetadata, admin: AdminCredentials): boolean {
  return metadata.visibility !== 'private' || isAuthorizedAdminRequest(req, admin);
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

function resolveRequestedDocumentId(req: express.Request): string {
  const fromIdQuery = typeof req.query.id === 'string' ? req.query.id : '';
  const fromLegacySlugQuery = typeof req.query.slug === 'string' ? req.query.slug : '';
  const fromReferer = parseIdFromReferer(req.get('referer'));
  return normalizeDocumentId(fromIdQuery || fromLegacySlugQuery || fromReferer || '');
}

function decodeUriSafe(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function normalizeAssetPath(value: string): string {
  const decoded = decodeUriSafe(value.trim());
  if (!decoded) {
    return '';
  }

  if (decoded.startsWith('#') || decoded.startsWith('/') || decoded.startsWith('//')) {
    return '';
  }

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded)) {
    return '';
  }

  const separatorIndex = decoded.search(/[?#]/);
  const withoutSuffix = (separatorIndex === -1 ? decoded : decoded.slice(0, separatorIndex))
    .replace(/\\/g, '/')
    .trim();
  if (!withoutSuffix) {
    return '';
  }

  const normalized = path.posix.normalize(withoutSuffix).replace(/^(\.\/)+/, '');
  if (
    !normalized ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.startsWith('/')
  ) {
    return '';
  }

  return normalized;
}

function resolvePathWithinRoot(rootDir: string, relativePath: string): string | null {
  const normalizedRelativePath = normalizeAssetPath(relativePath);
  if (!normalizedRelativePath) {
    return null;
  }

  const absoluteRootDir = path.resolve(rootDir);
  const candidatePath = path.resolve(absoluteRootDir, normalizedRelativePath);
  const candidateRelativePath = path.relative(absoluteRootDir, candidatePath);
  if (!candidateRelativePath || candidateRelativePath.startsWith('..') || path.isAbsolute(candidateRelativePath)) {
    return null;
  }

  return candidatePath;
}

function parsePushAssets(value: PushBody['assets']): { assets: PushAsset[] } | { error: string } {
  if (value === undefined) {
    return { assets: [] };
  }

  if (!Array.isArray(value)) {
    return { error: 'Body `assets` must be an array when provided.' };
  }

  if (value.length > MAX_PUSH_ASSET_COUNT) {
    return { error: `Body \`assets\` exceeds the limit of ${MAX_PUSH_ASSET_COUNT} files.` };
  }

  const parsedAssets: PushAsset[] = [];
  let totalBytes = 0;

  for (const [index, rawAsset] of value.entries()) {
    if (!rawAsset || typeof rawAsset !== 'object' || Array.isArray(rawAsset)) {
      return { error: `Body \`assets[${index}]\` must be an object.` };
    }

    const normalizedPath =
      typeof rawAsset.path === 'string' ? normalizeAssetPath(rawAsset.path) : '';
    if (!normalizedPath) {
      return { error: `Body \`assets[${index}].path\` must be a safe relative path.` };
    }

    if (typeof rawAsset.dataBase64 !== 'string') {
      return { error: `Body \`assets[${index}].dataBase64\` must be a base64 string.` };
    }

    let data: Buffer;
    try {
      data = Buffer.from(rawAsset.dataBase64, 'base64');
    } catch {
      return { error: `Body \`assets[${index}].dataBase64\` must be valid base64.` };
    }

    totalBytes += data.length;
    if (totalBytes > MAX_PUSH_ASSET_BYTES) {
      return { error: `Body \`assets\` exceeds ${Math.round(MAX_PUSH_ASSET_BYTES / (1024 * 1024))} MB.` };
    }

    parsedAssets.push({
      path: normalizedPath,
      data
    });
  }

  return { assets: parsedAssets };
}

function getDocumentAssetDirectory(assetsDir: string, id: string): string {
  return path.join(assetsDir, id);
}

async function writeDocumentAssets(assetsDir: string, id: string, assets: PushAsset[]): Promise<void> {
  const documentAssetDir = getDocumentAssetDirectory(assetsDir, id);
  await fs.rm(documentAssetDir, { recursive: true, force: true });

  if (assets.length === 0) {
    return;
  }

  await Promise.all(
    assets.map(async (asset) => {
      const destinationPath = resolvePathWithinRoot(documentAssetDir, asset.path);
      if (!destinationPath) {
        throw new Error(`Invalid asset path: ${asset.path}`);
      }

      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.writeFile(destinationPath, asset.data);
    })
  );
}

function toPdfFileName(fileName: string): string {
  const normalized = normalizeDisplayFileName(fileName);
  const withoutExtension = normalized.replace(/\.[^.]+$/, '').trim();
  const baseName = withoutExtension || 'document';
  const safeName = baseName.replace(/[\\/:*?"<>|]/g, '-');
  return `${safeName}.pdf`;
}

function toPdfContentDisposition(fileName: string): string {
  const fallbackAscii = fileName.replace(/[\u0080-\uffff]/g, '').replace(/["\\]/g, '').trim();
  const fallback = fallbackAscii || 'document.pdf';
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
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

async function readDocumentMetadataRecord(
  docsDir: string,
  id: string
): Promise<DocumentMetadataRecord | null> {
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
    const visibility = normalizeDocumentVisibility(parsed.visibility);
    const folder = normalizeFolderName(parsed.folder);
    const metadata: DocumentMetadata = {
      id,
      fileName,
      createdAt: createdAt || new Date().toISOString(),
      updatedAt: updatedAt || createdAt || new Date().toISOString(),
      visibility,
      folder
    };
    const shouldRewrite =
      parsed.id !== id ||
      parsed.fileName !== fileName ||
      parsed.createdAt !== metadata.createdAt ||
      parsed.updatedAt !== metadata.updatedAt ||
      parsed.folder !== folder ||
      !isDocumentVisibility(typeof parsed.visibility === 'string' ? parsed.visibility : '');

    return {
      metadata,
      shouldRewrite
    };
  } catch {
    return null;
  }
}

async function readDocumentMetadata(docsDir: string, id: string): Promise<DocumentMetadata | null> {
  const record = await readDocumentMetadataRecord(docsDir, id);
  return record?.metadata ?? null;
}

async function ensureDocumentMetadata(docsDir: string, id: string): Promise<DocumentMetadata> {
  const docPath = getDocumentPath(docsDir, id);
  const stats = await fs.stat(docPath);
  const fallbackCreatedAt = toIsoStringFromTimeMs(stats.birthtimeMs || stats.ctimeMs);
  const fallbackUpdatedAt = toIsoStringFromTimeMs(stats.mtimeMs);
  const existingRecord = await readDocumentMetadataRecord(docsDir, id);
  const metadata: DocumentMetadata = {
    id,
    fileName: existingRecord?.metadata.fileName ?? `${id}.md`,
    createdAt: existingRecord?.metadata.createdAt ?? fallbackCreatedAt,
    updatedAt: existingRecord?.metadata.updatedAt ?? fallbackUpdatedAt,
    visibility: existingRecord?.metadata.visibility ?? 'private',
    folder: existingRecord?.metadata.folder ?? ''
  };

  if (!existingRecord || existingRecord.shouldRewrite) {
    await writeDocumentMetadata(docsDir, metadata);
  }

  return metadata;
}

async function listDocuments(docsDir: string): Promise<DocumentListItem[]> {
  const entries = await fs.readdir(docsDir, { withFileTypes: true });
  const markdownEntries = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md'));

  const documents = await Promise.all(
    markdownEntries.map(async (entry) => {
      const id = entry.name.slice(0, -3);
      const metadata = await ensureDocumentMetadata(docsDir, id);

      return {
        id,
        fileName: metadata.fileName,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        visibility: metadata.visibility,
        folder: metadata.folder,
        path: `/d/${encodeURIComponent(id)}`
      } satisfies DocumentListItem;
    })
  );

  documents.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  return documents;
}

async function listAccessibleDocuments(
  docsDir: string,
  req: express.Request,
  admin: AdminCredentials
): Promise<DocumentListItem[]> {
  const documents = await listDocuments(docsDir);
  if (isAuthorizedAdminRequest(req, admin)) {
    return documents;
  }

  return documents.filter((document) => document.visibility === 'pinned');
}

function filterDocumentsByFolder(documents: DocumentListItem[], folderName: string): DocumentListItem[] {
  return documents.filter((document) => document.folder === folderName);
}

function summarizeDocumentFolders(documents: DocumentListItem[]): FolderListItem[] {
  const folders = new Map<string, FolderListItem>();

  for (const document of documents) {
    const folderName = document.folder;
    const existing = folders.get(folderName);
    const nextUpdatedAt = existing && Date.parse(existing.updatedAt) > Date.parse(document.updatedAt)
      ? existing.updatedAt
      : document.updatedAt;

    folders.set(folderName, {
      name: folderName,
      displayName: getFolderDisplayName(folderName),
      path: getFolderPath(folderName),
      total: (existing?.total ?? 0) + 1,
      pinnedCount: (existing?.pinnedCount ?? 0) + (document.visibility === 'pinned' ? 1 : 0),
      privateCount: (existing?.privateCount ?? 0) + (document.visibility === 'private' ? 1 : 0),
      updatedAt: nextUpdatedAt
    });
  }

  return [...folders.values()].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

async function readMarkdownWithMetadata(
  docsDir: string,
  id: string
): Promise<{ markdown: string; metadata: DocumentMetadata }> {
  const docPath = getDocumentPath(docsDir, id);
  const [markdown, metadata] = await Promise.all([fs.readFile(docPath, 'utf8'), ensureDocumentMetadata(docsDir, id)]);

  return {
    markdown,
    metadata
  };
}

async function writePushedDocument(
  docsDir: string,
  markdown: string,
  fileName: string | undefined,
  requestedId: string,
  visibility?: DocumentVisibility,
  folder?: string
): Promise<PushResult> {
  const normalizedFileName = normalizeDisplayFileName(fileName);
  const normalizedFolder = folder === undefined ? undefined : normalizeFolderName(folder);
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
        updatedAt: now,
        visibility: visibility ?? existingMetadata?.visibility ?? 'private',
        folder: normalizedFolder ?? existingMetadata?.folder ?? ''
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
    updatedAt: now,
    visibility: visibility ?? 'private',
    folder: normalizedFolder ?? ''
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

async function deleteDocument(docsDir: string, assetsDir: string, id: string): Promise<boolean> {
  const docPath = getDocumentPath(docsDir, id);
  if (!(await fileExists(docPath))) {
    return false;
  }

  await Promise.all([
    fs.rm(docPath),
    fs.rm(getMetadataPath(docsDir, id), { force: true }),
    fs.rm(getDocumentAssetDirectory(assetsDir, id), { recursive: true, force: true })
  ]);

  return true;
}

async function updateDocumentContent(
  docsDir: string,
  id: string,
  updates: { markdown?: string; visibility?: DocumentVisibility; folder?: string }
): Promise<DocumentMetadata | null> {
  const docPath = getDocumentPath(docsDir, id);
  if (!(await fileExists(docPath))) {
    return null;
  }

  const markdownUpdate = typeof updates.markdown === 'string' ? updates.markdown : null;
  const hasMarkdownUpdate = markdownUpdate !== null;
  const hasVisibilityUpdate = typeof updates.visibility === 'string';
  const hasFolderUpdate = updates.folder !== undefined;
  if (!hasMarkdownUpdate && !hasVisibilityUpdate && !hasFolderUpdate) {
    return ensureDocumentMetadata(docsDir, id);
  }

  const metadata = await ensureDocumentMetadata(docsDir, id);
  const now = new Date().toISOString();
  const nextMetadata: DocumentMetadata = {
    ...metadata,
    updatedAt: now,
    visibility: updates.visibility ?? metadata.visibility,
    folder: hasFolderUpdate ? normalizeFolderName(updates.folder) : metadata.folder
  };

  const pendingWrites: Promise<unknown>[] = [writeDocumentMetadata(docsDir, nextMetadata)];
  if (markdownUpdate !== null) {
    pendingWrites.push(fs.writeFile(docPath, markdownUpdate, 'utf8'));
  }

  await Promise.all(pendingWrites);
  return nextMetadata;
}

function createAdminAuthMiddleware(admin: AdminCredentials): express.RequestHandler {
  return (req, res, next) => {
    if (!isAuthorizedAdminRequest(req, admin)) {
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
  const assetsDir = path.join(config.dataDir, 'assets');
  await Promise.all([
    fs.mkdir(docsDir, { recursive: true }),
    fs.mkdir(assetsDir, { recursive: true })
  ]);

  const app = express();
  const requireAdminAuth = createAdminAuthMiddleware(config.admin);
  app.set('trust proxy', true);
  app.use(express.json({ limit: PUSH_JSON_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: false }));

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

    const visibilityValue = typeof body.visibility === 'string' ? body.visibility : undefined;
    if (visibilityValue !== undefined && !isDocumentVisibility(visibilityValue)) {
      res.status(400).json({ error: 'Body `visibility` must be `private` or `pinned`.' });
      return;
    }

    const requestedVisibility = visibilityValue
      ? normalizeDocumentVisibility(visibilityValue)
      : undefined;

    const parsedAssetsResult = parsePushAssets(body.assets);
    if ('error' in parsedAssetsResult) {
      res.status(400).json({ error: parsedAssetsResult.error });
      return;
    }

    let pushResult: PushResult;
    try {
      pushResult = await writePushedDocument(
        docsDir,
        body.markdown,
        body.fileName,
        requestedId,
        requestedVisibility
      );

      await writeDocumentAssets(assetsDir, pushResult.id, parsedAssetsResult.assets);
    } catch {
      res.status(500).json({ error: 'Failed to persist markdown document and assets.' });
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

  const sendNotFoundPageResponse = (res: express.Response) => {
    res.status(404).json({ error: PAGE_NOT_FOUND_MESSAGE });
  };

  const readAccessibleDocument = async (
    req: express.Request,
    res: express.Response,
    id: string
  ): Promise<{ markdown: string; metadata: DocumentMetadata } | null> => {
    try {
      const document = await readMarkdownWithMetadata(docsDir, id);
      if (!canAccessDocument(req, document.metadata, config.admin)) {
        sendNotFoundPageResponse(res);
        return null;
      }

      return document;
    } catch (error) {
      if (isNotFoundError(error)) {
        sendNotFoundPageResponse(res);
        return null;
      }

      throw error;
    }
  };

  app.get('/api/assets/:id/:assetPath(*)', async (req, res) => {
    const id = normalizeDocumentId(req.params.id ?? '');
    if (!id) {
      sendNotFoundPageResponse(res);
      return;
    }

    const params = req.params as Record<string, unknown>;
    const rawAssetPathValue = params.assetPath ?? params['assetPath(*)'] ?? params['0'];
    const rawAssetPath = typeof rawAssetPathValue === 'string' ? rawAssetPathValue : '';
    const documentAssetDir = getDocumentAssetDirectory(assetsDir, id);
    const absoluteAssetPath = resolvePathWithinRoot(documentAssetDir, rawAssetPath);
    if (!absoluteAssetPath) {
      sendNotFoundPageResponse(res);
      return;
    }

    try {
      const metadata = await ensureDocumentMetadata(docsDir, id);
      if (!canAccessDocument(req, metadata, config.admin)) {
        sendNotFoundPageResponse(res);
        return;
      }

      const assetStats = await fs.stat(absoluteAssetPath);
      if (!assetStats.isFile()) {
        sendNotFoundPageResponse(res);
        return;
      }

      res.setHeader('cache-control', 'no-store');
      res.sendFile(absoluteAssetPath);
    } catch (error) {
      if (isNotFoundError(error)) {
        sendNotFoundPageResponse(res);
        return;
      }

      res.status(500).type('text/plain; charset=utf-8').send('Unable to load this asset right now. Please try again.');
    }
  });

  const sendPdfResponse = async (
    req: express.Request,
    res: express.Response,
    id: string
  ): Promise<void> => {
    try {
      const document = await readAccessibleDocument(req, res, id);
      if (!document) {
        return;
      }

      const pdf = await renderMarkdownToPdf({
        markdown: document.markdown,
        title: document.metadata.fileName,
        sourceDir: docsDir
      });

      res.setHeader('cache-control', 'no-store');
      res.setHeader('content-disposition', toPdfContentDisposition(toPdfFileName(document.metadata.fileName)));
      res.type('application/pdf').send(pdf);
    } catch {
      res.status(500).json({
        error: 'Failed to generate PDF. Ensure Chromium is installed (`bunx playwright install chromium`).'
      });
    }
  };

  app.get('/api/markdown/:id/pdf', async (req, res) => {
    const id = normalizeDocumentId(req.params.id ?? '');
    if (!id) {
      res.status(400).json({ error: 'Invalid document id.' });
      return;
    }

    await sendPdfResponse(req, res, id);
  });

  app.get('/api/markdown/pdf', async (req, res) => {
    const id = resolveRequestedDocumentId(req);
    if (!id) {
      res.status(400).json({ error: 'Missing id. Open a public document URL at /d/<id>.' });
      return;
    }

    await sendPdfResponse(req, res, id);
  });

  app.get('/api/markdown/:id', async (req, res) => {
    const id = normalizeDocumentId(req.params.id ?? '');
    if (!id) {
      res.status(400).json({ error: 'Invalid document id.' });
      return;
    }

    try {
      const document = await readAccessibleDocument(req, res, id);
      if (!document) {
        return;
      }

      res.setHeader('x-md-path', document.metadata.fileName);
      res.setHeader('x-md-visibility', document.metadata.visibility);
      res.setHeader('x-md-folder', document.metadata.folder);
      res.type('text/plain; charset=utf-8').send(document.markdown);
    } catch {
      res.status(500).json({ error: 'Unable to load this page right now. Please try again.' });
    }
  });

  app.get('/api/markdown', async (req, res) => {
    const id = resolveRequestedDocumentId(req);
    if (!id) {
      res.status(400).json({ error: 'Missing id. Open a public document URL at /d/<id>.' });
      return;
    }

    try {
      const document = await readAccessibleDocument(req, res, id);
      if (!document) {
        return;
      }

      res.setHeader('x-md-path', document.metadata.fileName);
      res.setHeader('x-md-visibility', document.metadata.visibility);
      res.setHeader('x-md-folder', document.metadata.folder);
      res.type('text/plain; charset=utf-8').send(document.markdown);
    } catch {
      res.status(500).json({ error: 'Unable to load this page right now. Please try again.' });
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

  app.get('/api/admin/session', (req, res) => {
    res.setHeader('cache-control', 'no-store');
    if (!isAuthorizedAdminRequest(req, config.admin)) {
      res.status(401).json({ ok: false });
      return;
    }

    res.json({ ok: true });
  });

  const sendFolderJsonResponse = async (
    req: express.Request,
    res: express.Response,
    folderName: string
  ): Promise<void> => {
    try {
      const accessibleDocuments = await listAccessibleDocuments(docsDir, req, config.admin);
      const folderDocuments = filterDocumentsByFolder(accessibleDocuments, folderName);

      res.setHeader('cache-control', 'no-store');
      res.json({
        folder: folderName,
        displayName: getFolderDisplayName(folderName),
        files: folderDocuments.map((document) => ({
          id: document.id,
          fileName: document.fileName,
          updatedAt: document.updatedAt,
          visibility: document.visibility,
          path: document.path
        }))
      });
    } catch {
      res.status(500).json({ error: 'Failed to load folder.' });
    }
  };

  app.get('/api/folders', async (req, res) => {
    await sendFolderJsonResponse(req, res, '');
  });

  app.get('/api/folders/:folderName', async (req, res) => {
    const folderName = normalizeFolderName(typeof req.params.folderName === 'string' ? req.params.folderName : '');
    await sendFolderJsonResponse(req, res, folderName);
  });

  app.put('/api/admin/files/:id', requireAdminAuth, async (req, res) => {
    const id = normalizeDocumentId(typeof req.params.id === 'string' ? req.params.id : '');
    if (!id) {
      res.status(400).json({ error: 'Invalid document id.' });
      return;
    }

    const body = (req.body ?? {}) as { markdown?: unknown; visibility?: unknown; folder?: unknown };
    const nextMarkdown = typeof body.markdown === 'string' ? body.markdown : undefined;
    const visibilityValue = typeof body.visibility === 'string' ? body.visibility : undefined;
    const hasVisibilityField = visibilityValue !== undefined;
    const nextVisibility = hasVisibilityField
      ? normalizeDocumentVisibility(visibilityValue)
      : undefined;
    const hasFolderField = body.folder !== undefined;
    const nextFolder = hasFolderField && typeof body.folder === 'string' ? normalizeFolderName(body.folder) : undefined;

    if (body.markdown !== undefined && typeof body.markdown !== 'string') {
      res.status(400).json({ error: 'Body `markdown` must be a string.' });
      return;
    }

    if (hasVisibilityField && !isDocumentVisibility(visibilityValue)) {
      res.status(400).json({ error: 'Body `visibility` must be `private` or `pinned`.' });
      return;
    }

    if (hasFolderField && typeof body.folder !== 'string') {
      res.status(400).json({ error: 'Body `folder` must be a string.' });
      return;
    }

    if (nextMarkdown === undefined && !hasVisibilityField && !hasFolderField) {
      res.status(400).json({ error: 'Provide at least one update (`markdown`, `visibility`, or `folder`).' });
      return;
    }

    try {
      const updatedMetadata = await updateDocumentContent(docsDir, id, {
        markdown: nextMarkdown,
        visibility: nextVisibility,
        folder: hasFolderField ? nextFolder : undefined
      });

      if (!updatedMetadata) {
        res.status(404).json({ error: `Document not found: ${id}` });
        return;
      }

      res.setHeader('cache-control', 'no-store');
      res.json({
        ok: true,
        id,
        fileName: updatedMetadata.fileName,
        updatedAt: updatedMetadata.updatedAt,
        visibility: updatedMetadata.visibility,
        folder: updatedMetadata.folder
      });
    } catch {
      res.status(500).json({ error: 'Failed to update file.' });
    }
  });

  app.delete('/api/admin/files/:id', requireAdminAuth, async (req, res) => {
    const id = normalizeDocumentId(typeof req.params.id === 'string' ? req.params.id : '');
    if (!id) {
      res.status(400).json({ error: 'Invalid document id.' });
      return;
    }

    try {
      const wasDeleted = await deleteDocument(docsDir, assetsDir, id);
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
      const wasDeleted = await deleteDocument(docsDir, assetsDir, id);
      if (!wasDeleted) {
        res.redirect(303, '/admin?status=not-found');
        return;
      }

      res.redirect(303, `/admin?status=deleted&id=${encodeURIComponent(id)}`);
    } catch {
      res.redirect(303, '/admin?status=delete-error');
    }
  });

  app.post('/admin/files/:id/state', requireAdminAuth, async (req, res) => {
    const id = normalizeDocumentId(typeof req.params.id === 'string' ? req.params.id : '');
    const requestedVisibilityRaw = typeof req.body.visibility === 'string' ? req.body.visibility : '';
    if (!id) {
      res.redirect(303, '/admin?status=invalid-id');
      return;
    }

    if (!isDocumentVisibility(requestedVisibilityRaw)) {
      res.redirect(303, '/admin?status=invalid-visibility');
      return;
    }

    const requestedVisibility: DocumentVisibility = requestedVisibilityRaw;

    try {
      const updatedMetadata = await updateDocumentContent(docsDir, id, {
        visibility: requestedVisibility
      });
      if (!updatedMetadata) {
        res.redirect(303, '/admin?status=not-found');
        return;
      }

      res.redirect(
        303,
        `/admin?status=state-updated&id=${encodeURIComponent(id)}&visibility=${encodeURIComponent(updatedMetadata.visibility)}`
      );
    } catch {
      res.redirect(303, '/admin?status=state-error');
    }
  });

  app.post('/admin/files/:id/folder', requireAdminAuth, async (req, res) => {
    const id = normalizeDocumentId(typeof req.params.id === 'string' ? req.params.id : '');
    const requestedFolder = normalizeFolderName(typeof req.body.folder === 'string' ? req.body.folder : '');
    if (!id) {
      res.redirect(303, '/admin?status=invalid-id');
      return;
    }

    try {
      const updatedMetadata = await updateDocumentContent(docsDir, id, {
        folder: requestedFolder
      });
      if (!updatedMetadata) {
        res.redirect(303, '/admin?status=not-found');
        return;
      }

      res.redirect(
        303,
        `/admin?status=folder-updated&id=${encodeURIComponent(id)}&folder=${encodeURIComponent(updatedMetadata.folder)}`
      );
    } catch {
      res.redirect(303, '/admin?status=folder-error');
    }
  });

  app.post('/admin/files/create', requireAdminAuth, async (req, res) => {
    const requestedFileName =
      typeof req.body.fileName === 'string' ? req.body.fileName : undefined;
    const requestedFolder = normalizeFolderName(typeof req.body.folder === 'string' ? req.body.folder : '');

    try {
      const createdDocument = await writePushedDocument(
        docsDir,
        '',
        requestedFileName,
        '',
        undefined,
        requestedFolder
      );

      res.redirect(303, `/admin?status=created&id=${encodeURIComponent(createdDocument.id)}`);
    } catch {
      res.redirect(303, '/admin?status=create-error');
    }
  });

  app.get('/admin', requireAdminAuth, async (req, res) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : '';
      const statusId = typeof req.query.id === 'string' ? normalizeDocumentId(req.query.id) : '';
      const statusVisibilityRaw = typeof req.query.visibility === 'string' ? req.query.visibility : '';
      const statusVisibility = isDocumentVisibility(statusVisibilityRaw) ? statusVisibilityRaw : '';
      const statusFolder = normalizeFolderName(typeof req.query.folder === 'string' ? req.query.folder : '');
      const documents = await listDocuments(docsDir);
      const statusToast =
        status === 'created' && statusId
          ? {
              tone: 'success',
              body: `Created new page <code>${escapeHtml(statusId)}</code>. <a href="/d/${encodeURIComponent(statusId)}" target="_blank" rel="noopener noreferrer">Open page</a>.`
            }
          : status === 'create-error'
            ? {
                tone: 'error',
                body: 'Failed to create page.'
              }
            : status === 'deleted' && statusId
              ? {
                  tone: 'success',
                  body: `Deleted document <code>${escapeHtml(statusId)}</code>.`
                }
              : status === 'not-found'
                ? {
                    tone: 'error',
                    body: 'Document not found. It may have already been deleted.'
                  }
                : status === 'invalid-id'
                  ? {
                      tone: 'error',
                      body: 'Invalid document id.'
                    }
                  : status === 'invalid-visibility'
                    ? {
                        tone: 'error',
                        body: 'Invalid visibility state.'
                      }
                    : status === 'delete-error'
                      ? {
                          tone: 'error',
                          body: 'Failed to delete document.'
                        }
                      : status === 'state-updated' && statusId && statusVisibility
                        ? {
                            tone: 'success',
                            body: `Updated <code>${escapeHtml(statusId)}</code> to <strong>${escapeHtml(statusVisibility)}</strong>.`
                          }
                        : status === 'state-error'
                          ? {
                              tone: 'error',
                              body: 'Failed to update document visibility.'
                            }
                          : status === 'folder-updated' && statusId
                            ? {
                                tone: 'success',
                                body: `Moved <code>${escapeHtml(statusId)}</code> to <strong>${escapeHtml(getFolderDisplayName(statusFolder))}</strong>.`
                              }
                            : status === 'folder-error'
                              ? {
                                  tone: 'error',
                                  body: 'Failed to update document folder.'
                                }
                              : null;
      const statusToastMarkup = statusToast
        ? `<div class="toast-shell" aria-live="polite"><div class="toast is-${statusToast.tone}" role="${statusToast.tone === 'error' ? 'alert' : 'status'}"><div class="toast-message">${statusToast.body}</div><button type="button" class="toast-close" aria-label="Dismiss notification">x</button></div></div>`
        : '';
      const statusToastScript = statusToast
        ? `<script>
      (() => {
        const currentUrl = new URL(window.location.href);
        if (currentUrl.searchParams.has('status')) {
          currentUrl.searchParams.delete('status');
          currentUrl.searchParams.delete('id');
          currentUrl.searchParams.delete('visibility');
          currentUrl.searchParams.delete('folder');
          const nextSearch = currentUrl.searchParams.toString();
          const nextUrl = currentUrl.pathname + (nextSearch ? ('?' + nextSearch) : '') + currentUrl.hash;
          window.history.replaceState({}, '', nextUrl);
        }

        const toast = document.querySelector('.toast');
        if (!toast) {
          return;
        }

        const shell = toast.parentElement;
        const closeButton = toast.querySelector('.toast-close');
        let dismissed = false;

        const dismissToast = () => {
          if (dismissed) {
            return;
          }

          dismissed = true;
          toast.classList.add('is-leaving');
          window.setTimeout(() => {
            if (shell) {
              shell.remove();
            }
          }, 220);
        };

        if (closeButton) {
          closeButton.addEventListener('click', dismissToast);
        }

        window.setTimeout(dismissToast, 4200);
      })();
    </script>`
        : '';
      const rows =
        documents.length === 0
          ? '<tr><td colspan="6" class="empty">No files uploaded yet.</td></tr>'
          : documents
              .map((document) => {
                const deletePath = `/admin/files/${encodeURIComponent(document.id)}/delete`;
                const toggleVisibilityPath = `/admin/files/${encodeURIComponent(document.id)}/state`;
                const updateFolderPath = `/admin/files/${encodeURIComponent(document.id)}/folder`;
                const nextVisibility: DocumentVisibility =
                  document.visibility === 'pinned' ? 'private' : 'pinned';
                const stateIcon =
                  document.visibility === 'pinned' ? renderUiIcon('pin') : renderUiIcon('lock');
                const toggleLabel =
                  document.visibility === 'pinned'
                    ? 'Pinned. Click to switch to private.'
                    : 'Private. Click to pin to home.';
                return `<tr>
      <td class="actions-cell">
        <form method="post" action="${escapeHtml(toggleVisibilityPath)}">
          <input type="hidden" name="visibility" value="${escapeHtml(nextVisibility)}" />
          <button
            type="submit"
            class="state-toggle ${escapeHtml(document.visibility)}"
            title="${escapeHtml(toggleLabel)}"
            aria-label="${escapeHtml(toggleLabel)}"
          >
            <span aria-hidden="true" class="state-icon">${stateIcon}</span>
          </button>
        </form>
        <form method="post" action="${escapeHtml(deletePath)}" onsubmit="return window.confirm('Delete this page permanently?');">
          <button type="submit" class="icon-action danger-action" title="Delete page" aria-label="Delete page">${renderUiIcon('bin')}</button>
        </form>
      </td>
      <td><a href="${escapeHtml(document.path)}" target="_blank" rel="noopener noreferrer">${escapeHtml(document.fileName)}</a></td>
      <td class="folder-cell">
        <form method="post" action="${escapeHtml(updateFolderPath)}" class="folder-form">
          <input name="folder" type="text" value="${escapeHtml(document.folder)}" placeholder="${escapeHtml(UNFILED_FOLDER_LABEL)}" aria-label="Folder for ${escapeHtml(document.fileName)}" />
          <button type="submit">Save</button>
        </form>
      </td>
      <td><code>${escapeHtml(document.id)}</code></td>
      <td>${escapeHtml(formatUkDateTime(document.createdAt))}</td>
      <td>${escapeHtml(formatUkDateTime(document.updatedAt))}</td>
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
      body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; font-family: "SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
      main { width: min(980px, 100%); margin: 0 auto; padding: 40px 20px 30px; flex: 1; }
      h1 { margin: 0 0 8px; }
      p { margin: 0 0 20px; }
      .token-panel { margin: 0 0 20px; padding: 12px 14px; border: 1px solid rgba(127, 127, 127, 0.35); border-radius: 8px; }
      .token-panel p { margin: 0 0 8px; }
      .token-panel p:last-child { margin-bottom: 0; }
      .create-panel { margin: 0 0 20px; padding: 12px 14px; border: 1px solid rgba(127, 127, 127, 0.35); border-radius: 8px; }
      .create-form { margin: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
      .create-form label { font-weight: 600; }
      .create-form input { min-width: 220px; max-width: 360px; flex: 1 1 240px; padding: 8px 10px; border: 1px solid rgba(127, 127, 127, 0.45); border-radius: 8px; background: transparent; color: inherit; }
      .create-form button { border: 1px solid rgba(127, 127, 127, 0.45); border-radius: 8px; background: transparent; color: inherit; padding: 8px 12px; cursor: pointer; }
      .create-form button:hover { background: rgba(127, 127, 127, 0.12); }
      .create-form input:focus-visible, .create-form button:focus-visible { outline: 2px solid rgba(44, 111, 186, 0.72); outline-offset: 2px; }
      .folder-cell { min-width: 240px; }
      .folder-form { margin: 0; display: flex; align-items: center; gap: 8px; }
      .folder-form input { width: 100%; min-width: 120px; padding: 7px 9px; border: 1px solid rgba(127, 127, 127, 0.45); border-radius: 8px; background: transparent; color: inherit; }
      .folder-form button { border: 1px solid rgba(127, 127, 127, 0.45); border-radius: 8px; background: transparent; color: inherit; padding: 7px 10px; cursor: pointer; }
      .folder-form button:hover { background: rgba(127, 127, 127, 0.12); }
      .folder-form input:focus-visible, .folder-form button:focus-visible { outline: 2px solid rgba(44, 111, 186, 0.72); outline-offset: 2px; }
      table { width: 100%; border-collapse: collapse; }
      td { text-align: left; padding: 10px 12px; border-bottom: 1px solid rgba(127, 127, 127, 0.35); }
      .actions-cell { text-align: center; width: 116px; }
      .actions-cell { white-space: nowrap; }
      .actions-cell form { margin: 0; display: inline-flex; }
      .actions-cell form + form { margin-left: 6px; }
      .icon-action { width: 2rem; height: 2rem; border: 0; border-radius: 999px; display: inline-grid; place-items: center; color: inherit; text-decoration: none; background: transparent; padding: 0; cursor: pointer; }
      .icon-action:hover { background: rgba(127, 127, 127, 0.16); }
      .icon-action:focus { outline: none; }
      .state-toggle { width: 2rem; height: 2rem; border: 0; border-radius: 999px; background: transparent; color: inherit; padding: 0; line-height: 1; font-size: 1rem; display: inline-grid; place-items: center; cursor: pointer; }
      .state-toggle:hover { background: rgba(127, 127, 127, 0.16); }
      .state-toggle:focus { outline: none; }
      .icon-action:focus-visible, .state-toggle:focus-visible { outline: 2px solid rgba(44, 111, 186, 0.72); outline-offset: 2px; }
      .state-toggle.pinned { color: rgba(18, 112, 173, 0.95); }
      .state-toggle .state-icon { display: inline-grid; place-items: center; width: 1rem; height: 1rem; }
      .ui-icon { width: 1rem; height: 1rem; display: block; }
      .danger-action { color: rgba(168, 34, 34, 0.95); }
      .danger-action:hover { background: rgba(168, 34, 34, 0.16); }
      code { font-size: 0.9em; font-family: "RobotoMono Nerd Font", "RobotoMono Nerd Font Mono", "Roboto Mono Nerd Font", "RobotoMonoNerdFont", "Roboto Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
      .empty { color: #666; text-align: center; }
      .toast-shell { position: fixed; top: 18px; right: 18px; z-index: 30; pointer-events: none; }
      .toast { max-width: min(420px, calc(100vw - 36px)); display: flex; align-items: flex-start; gap: 10px; padding: 11px 12px 11px 14px; border-radius: 12px; border: 1px solid rgba(127, 127, 127, 0.45); background: color-mix(in srgb, Canvas 94%, transparent); box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18); pointer-events: auto; }
      .toast.is-success { border-color: rgba(15, 140, 74, 0.55); }
      .toast.is-error { border-color: rgba(168, 34, 34, 0.6); }
      .toast.is-leaving { opacity: 0; transform: translateY(-6px); transition: opacity 0.2s ease, transform 0.2s ease; }
      .toast-message { margin: 0; line-height: 1.45; font-size: 0.92rem; }
      .toast-message a { color: inherit; }
      .toast-close { width: 1.55rem; height: 1.55rem; border: 0; border-radius: 999px; background: transparent; color: inherit; cursor: pointer; line-height: 1; padding: 0; flex: 0 0 auto; }
      .toast-close:hover { background: rgba(127, 127, 127, 0.16); }
      .bottom-bar { border-top: 1px solid rgba(127, 127, 127, 0.35); padding: 0.56rem 1rem; display: flex; justify-content: center; background: color-mix(in srgb, Canvas 96%, transparent); }
      .repo-link { width: 2.2rem; height: 2.2rem; border-radius: 999px; display: inline-grid; place-items: center; color: inherit; text-decoration: none; }
      .repo-link:hover { background: rgba(127, 127, 127, 0.16); }
      .repo-link .ui-icon { width: 1.12rem; height: 1.12rem; display: block; overflow: visible; }
    </style>
  </head>
  <body>
    <main>
      <h1>mdv admin</h1>
      <p>Uploaded files: ${documents.length}</p>
      <section class="token-panel" aria-label="Server token">
        <p>Server token: <code>${escapeHtml(config.token)}</code></p>
        <p>Source: <code>${escapeHtml(config.tokenSource)}</code></p>
      </section>
      <section class="create-panel" aria-label="Add new page">
        <form method="post" action="/admin/files/create" class="create-form">
          <label for="new-file-name">Add new page</label>
          <input id="new-file-name" name="fileName" type="text" placeholder="new-page.md" />
          <input name="folder" type="text" placeholder="Folder (${escapeHtml(UNFILED_FOLDER_LABEL)})" aria-label="Folder" />
          <button type="submit">Add</button>
        </form>
      </section>
      <table>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </main>
    ${statusToastMarkup}
    ${statusToastScript}
    <footer class="bottom-bar" aria-label="Repository link">
      <a
        href="${escapeHtml(REPOSITORY_URL)}"
        class="repo-link"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open project on GitHub"
        title="GitHub"
      >${renderGithubIcon()}</a>
    </footer>
  </body>
</html>`);
    } catch {
      res.status(500).type('text/plain; charset=utf-8').send('Failed to render admin page.');
    }
  });

  const renderFolderVisibilitySummary = (folder: FolderListItem): string => {
    const pinned = folder.pinnedCount > 0
      ? `<span class="visibility-count pinned" title="Pinned pages">${renderUiIcon('pin')}<span>${folder.pinnedCount}</span></span>`
      : '';
    const privatePages = folder.privateCount > 0
      ? `<span class="visibility-count private" title="Private pages">${renderUiIcon('lock')}<span>${folder.privateCount}</span></span>`
      : '';

    return `${pinned}${privatePages}`;
  };

  const renderDocumentVisibilityIcon = (document: DocumentListItem): string => {
    const title = document.visibility === 'pinned' ? 'Pinned page' : 'Private page';
    const icon = document.visibility === 'pinned' ? renderUiIcon('pin') : renderUiIcon('lock');
    return `<span class="page-visibility ${escapeHtml(document.visibility)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${icon}</span>`;
  };

  const renderDirectoryPage = (input: {
    title: string;
    heading: string;
    description: string;
    body: string;
    isAdmin: boolean;
  }): string => {
    const adminLink = input.isAdmin
      ? `<a href="/admin" class="admin-link" aria-label="Open admin" title="Admin">${renderUiIcon('admin')}</a>`
      : '';

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/png" sizes="16x16" href="${escapeHtml(APP_ICON_16_URL)}" />
    <link rel="icon" type="image/png" sizes="32x32" href="${escapeHtml(APP_ICON_32_URL)}" />
    <link rel="shortcut icon" type="image/png" href="${escapeHtml(APP_ICON_32_URL)}" />
    <link rel="apple-touch-icon" href="${escapeHtml(APP_ICON_TOUCH_URL)}" />
    <title>${escapeHtml(input.title)}</title>
    <style>
      body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; font-family: "SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background: #f7f7f5; color: #161616; }
      main { width: min(800px, 100%); margin: 0 auto; padding: 10vh 24px 32px; flex: 1; }
      .home-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
      .home-heading { min-width: 0; }
      .admin-link { flex: 0 0 auto; width: 2.4rem; height: 2.4rem; border-radius: 999px; display: inline-grid; place-items: center; color: #343434; text-decoration: none; }
      .admin-link:hover { background: rgba(127, 127, 127, 0.15); color: #161616; }
      h1 { margin: 0 0 8px; font-size: 2rem; }
      p { margin: 0 0 18px; line-height: 1.65; color: #3f3f3f; }
      ul { list-style: none; margin: 16px 0 0; padding: 0; border: 1px solid #d7d7d2; border-radius: 12px; background: #ffffff; }
      li { border-bottom: 1px solid #e6e6e2; }
      li:last-child { border-bottom: 0; }
      li a { color: inherit; text-decoration: none; }
      .folder-link, .page-link { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 14px; }
      .folder-link:hover, .page-link:hover { background: #f7f7f5; }
      .folder-title, .page-title { min-width: 0; display: inline-flex; align-items: center; gap: 10px; font-weight: 600; }
      .folder-title span:last-child, .page-title span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .folder-meta, .page-meta { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 10px; color: #5f5f5f; font-size: 0.9rem; white-space: nowrap; }
      .visibility-count, .page-visibility { display: inline-flex; align-items: center; gap: 4px; color: #5f5f5f; }
      .visibility-count.pinned, .page-visibility.pinned { color: #126fad; }
      .visibility-count.private, .page-visibility.private { color: #5f5f5f; }
      .ui-icon { width: 1rem; height: 1rem; display: block; }
      .empty { display: block; padding: 12px 14px; color: #5f5f5f; }
      .back-link { display: inline-flex; margin-bottom: 14px; color: #3f3f3f; text-decoration: none; }
      .back-link:hover { text-decoration: underline; }
      .bottom-bar { border-top: 1px solid #d7d7d2; padding: 0.56rem 1rem; display: flex; justify-content: center; background: color-mix(in srgb, #f7f7f5 92%, #ffffff); }
      .repo-link { width: 2.2rem; height: 2.2rem; border-radius: 999px; display: inline-grid; place-items: center; color: #545454; text-decoration: none; }
      .repo-link:hover { background: rgba(127, 127, 127, 0.15); color: #161616; }
      .repo-link .ui-icon { width: 1.12rem; height: 1.12rem; display: block; overflow: visible; }
      @media (max-width: 680px) {
        .folder-link, .page-link { align-items: flex-start; flex-direction: column; }
        .folder-meta, .page-meta { flex-wrap: wrap; white-space: normal; }
      }
    </style>
  </head>
  <body>
    <main>
      <header class="home-header">
        <div class="home-heading">
          <h1>${escapeHtml(input.heading)}</h1>
          <p>${escapeHtml(input.description)}</p>
        </div>
        ${adminLink}
      </header>
      ${input.body}
    </main>
    <footer class="bottom-bar" aria-label="Repository link">
      <a
        href="${escapeHtml(REPOSITORY_URL)}"
        class="repo-link"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open project on GitHub"
        title="GitHub"
      >${renderGithubIcon()}</a>
    </footer>
  </body>
</html>`;
  };

  app.get('/', async (req, res) => {
    try {
      const isAdmin = isAuthorizedAdminRequest(req, config.admin);
      const accessibleDocuments = await listAccessibleDocuments(docsDir, req, config.admin);
      const folders = summarizeDocumentFolders(accessibleDocuments);
      const folderRows = folders.length === 0
        ? '<li class="empty">No folders here yet.</li>'
        : folders
            .map((folder) => {
              const pageLabel = folder.total === 1 ? '1 page' : `${folder.total} pages`;
              return `<li>
        <a href="${escapeHtml(folder.path)}" class="folder-link">
          <span class="folder-title">${renderUiIcon('folder')}<span>${escapeHtml(folder.displayName)}</span></span>
          <span class="folder-meta"><span>${escapeHtml(pageLabel)}</span>${renderFolderVisibilitySummary(folder)}</span>
        </a>
      </li>`;
            })
            .join('\n');
      const description = isAdmin
        ? 'Folders with pinned and private pages you can access.'
        : 'Folders with pinned pages you can open and read quickly.';

      res.type('text/html; charset=utf-8').send(renderDirectoryPage({
        title: 'mdv home',
        heading: 'mdv',
        description,
        body: `<ul>${folderRows}</ul>`,
        isAdmin
      }));
    } catch {
      res.status(500).type('text/plain; charset=utf-8').send('Failed to render homepage.');
    }
  });

  const sendFolderPageResponse = async (
    req: express.Request,
    res: express.Response,
    folderName: string
  ): Promise<void> => {
    try {
      const isAdmin = isAuthorizedAdminRequest(req, config.admin);
      const accessibleDocuments = await listAccessibleDocuments(docsDir, req, config.admin);
      const folderDocuments = filterDocumentsByFolder(accessibleDocuments, folderName);
      const pageRows = folderDocuments.length === 0
        ? '<li class="empty">No pages in this folder yet.</li>'
        : folderDocuments
            .map((document) => `<li>
        <a href="${escapeHtml(document.path)}" class="page-link">
          <span class="page-title">${renderDocumentVisibilityIcon(document)}<span>${escapeHtml(document.fileName)}</span></span>
          <span class="page-meta">Updated ${escapeHtml(formatUkDateTime(document.updatedAt))}</span>
        </a>
      </li>`)
            .join('\n');
      const displayName = getFolderDisplayName(folderName);

      res.type('text/html; charset=utf-8').send(renderDirectoryPage({
        title: `${displayName} - mdv`,
        heading: displayName,
        description: 'Pages in this folder.',
        body: `<a href="/" class="back-link">Back to folders</a><ul>${pageRows}</ul>`,
        isAdmin
      }));
    } catch {
      res.status(500).type('text/plain; charset=utf-8').send('Failed to render folder.');
    }
  };

  app.get('/folders', (req, res) => {
    void sendFolderPageResponse(req, res, '');
  });

  app.get('/folders/:folderName', (req, res) => {
    const folderName = normalizeFolderName(typeof req.params.folderName === 'string' ? req.params.folderName : '');
    void sendFolderPageResponse(req, res, folderName);
  });

  app.use(express.static(WEB_DIST_PATH, { index: false }));

  const sendDocumentNotFoundPage = (res: express.Response) => {
    res.status(404).type('text/html; charset=utf-8').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Page not found</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; font-family: "SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background: #f7f7f5; color: #161616; }
      main { width: min(560px, 100%); border: 1px solid #d8d8d3; border-radius: 14px; padding: 20px 18px; background: #ffffff; }
      h1 { margin: 0 0 8px; font-size: 1.4rem; }
      p { margin: 0 0 12px; line-height: 1.55; color: #3f3f3f; }
      a { color: inherit; }
    </style>
  </head>
  <body>
    <main>
      <h1>Page not found</h1>
      <p>${escapeHtml(PAGE_NOT_FOUND_MESSAGE)}</p>
      <p><a href="/">Go back home</a></p>
    </main>
  </body>
</html>`);
  };

  const handleDocumentShellRequest = async (req: express.Request, res: express.Response) => {
    const rawId = typeof req.params.id === 'string' ? req.params.id : '';
    const id = normalizeDocumentId(rawId);
    if (!id) {
      sendDocumentNotFoundPage(res);
      return;
    }

    try {
      const metadata = await ensureDocumentMetadata(docsDir, id);
      if (!canAccessDocument(req, metadata, config.admin)) {
        sendDocumentNotFoundPage(res);
        return;
      }

      res.sendFile(path.join(WEB_DIST_PATH, 'index.html'));
    } catch (error) {
      if (isNotFoundError(error)) {
        sendDocumentNotFoundPage(res);
        return;
      }

      res.status(500).type('text/plain; charset=utf-8').send('Unable to open this page right now. Please try again.');
    }
  };

  app.get('/d/:id', (req, res) => {
    void handleDocumentShellRequest(req, res);
  });

  app.get('/d/:id/*', (req, res) => {
    void handleDocumentShellRequest(req, res);
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
