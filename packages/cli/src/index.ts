#!/usr/bin/env node

import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import getPort, { portNumbers } from 'get-port';
import open from 'open';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WEB_DIST_PATH = path.resolve(__dirname, '../../web/dist');
const DEFAULT_PORT_RANGE = portNumbers(4173, 4300);
const CONFIG_APP_DIR_NAME = 'mdv';
const CONFIG_FILE_NAME = 'config.json';

type LocalViewOptions = {
  markdownPathArg?: string;
  port?: number;
  shouldOpenBrowser: boolean;
};

type PushOptions = {
  markdownPathArg?: string;
  server?: string;
  token?: string;
};

type RemoteSetOptions = {
  server?: string;
};

type RemotePairOptions = {
  server?: string;
  token?: string;
};

type Command =
  | { type: 'local-view'; options: LocalViewOptions }
  | { type: 'push'; options: PushOptions }
  | { type: 'remote-set'; options: RemoteSetOptions }
  | { type: 'remote-pair'; options: RemotePairOptions }
  | { type: 'remote-clear' }
  | { type: 'remote-show' };

type PushResponse = {
  id: string;
  url: string;
};

type MdvConfig = {
  remote?: string;
  token?: string;
};

function printUsage(): void {
  console.error('Usage:');
  console.error('  mdv <path-to-markdown-file> [--port <number>] [--no-open]');
  console.error('  mdv push <path-to-markdown-file> [--server <url>] [--token <token>]');
  console.error('  mdv remote set <server-url>');
  console.error('  mdv remote pair <server-url> <token>');
  console.error('  mdv remote clear');
  console.error('  mdv remote show');
}

function getHomeDir(): string {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE;
  if (!homeDir) {
    throw new Error('Unable to resolve home directory for mdv config.');
  }

  return homeDir;
}

function getConfigDir(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (appData) {
      return path.join(appData, CONFIG_APP_DIR_NAME);
    }

    return path.join(getHomeDir(), 'AppData', 'Roaming', CONFIG_APP_DIR_NAME);
  }

  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  if (xdgConfigHome) {
    const baseDir = path.isAbsolute(xdgConfigHome)
      ? xdgConfigHome
      : path.resolve(xdgConfigHome);
    return path.join(baseDir, CONFIG_APP_DIR_NAME);
  }

  return path.join(getHomeDir(), '.config', CONFIG_APP_DIR_NAME);
}

function getConfigPath(): string {
  return path.join(getConfigDir(), CONFIG_FILE_NAME);
}

function parseLocalViewOptions(argv: string[]): LocalViewOptions {
  const args = argv.filter((arg) => arg !== '--');
  const positional: string[] = [];
  let shouldOpenBrowser = true;
  let port: number | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '--no-open') {
      shouldOpenBrowser = false;
      continue;
    }

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

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positional.push(arg);
  }

  return {
    markdownPathArg: positional[0],
    port,
    shouldOpenBrowser
  };
}

function parsePushOptions(argv: string[]): PushOptions {
  const args = argv.filter((arg) => arg !== '--');
  const positional: string[] = [];
  let server: string | undefined;
  let token: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '--server') {
      const next = args[i + 1];
      if (!next) {
        throw new Error('Missing value for --server.');
      }

      server = next;
      i += 1;
      continue;
    }

    if (arg === '--token') {
      const next = args[i + 1];
      if (!next) {
        throw new Error('Missing value for --token.');
      }

      token = next;
      i += 1;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positional.push(arg);
  }

  return {
    markdownPathArg: positional[0],
    server,
    token
  };
}

function parseCommand(argv: string[]): Command {
  const args = argv.filter((arg) => arg !== '--');

  if (args[0] === 'push') {
    return {
      type: 'push',
      options: parsePushOptions(args.slice(1))
    };
  }

  if (args[0] === 'remote') {
    if (args[1] === 'set') {
      const server = args[2];
      if (!server) {
        throw new Error('Usage: mdv remote set <server-url>');
      }

      return {
        type: 'remote-set',
        options: { server }
      };
    }

    if (args[1] === 'show') {
      return {
        type: 'remote-show'
      };
    }

    if (args[1] === 'clear') {
      return {
        type: 'remote-clear'
      };
    }

    if (args[1] === 'pair') {
      const server = args[2];
      const token = args[3];
      if (!server || !token) {
        throw new Error('Usage: mdv remote pair <server-url> <token>');
      }

      return {
        type: 'remote-pair',
        options: { server, token }
      };
    }

    throw new Error('Usage: mdv remote <set|pair|clear|show>');
  }

  return {
    type: 'local-view',
    options: parseLocalViewOptions(args)
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveMarkdownPath(inputPath: string): Promise<string> {
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }

  const candidates = new Set<string>();
  const initCwd = process.env.INIT_CWD;

  if (initCwd) {
    candidates.add(path.resolve(initCwd, inputPath));
  }

  candidates.add(path.resolve(process.cwd(), inputPath));

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return [...candidates][0] ?? path.resolve(process.cwd(), inputPath);
}

async function assertBuildExists(): Promise<void> {
  const indexPath = path.join(WEB_DIST_PATH, 'index.html');

  if (!(await fileExists(indexPath))) {
    throw new Error(
      `Web build not found at ${WEB_DIST_PATH}. Run \`bun run build\` first.`
    );
  }
}

async function validateMarkdownPath(markdownPath: string): Promise<void> {
  if (path.extname(markdownPath).toLowerCase() !== '.md') {
    throw new Error('The input file must use a .md extension.');
  }

  const stats = await fs.stat(markdownPath).catch(() => {
    throw new Error(`Markdown file not found: ${markdownPath}`);
  });

  if (!stats.isFile()) {
    throw new Error(`Path is not a file: ${markdownPath}`);
  }
}

function normalizeServerUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Invalid server URL protocol: ${parsed.protocol}`);
  }

  return parsed.toString().replace(/\/+$/, '');
}

async function readConfig(): Promise<MdvConfig> {
  const configPath = getConfigPath();
  if (!(await fileExists(configPath))) {
    return {};
  }

  const raw = await fs.readFile(configPath, 'utf8');
  const parsed = JSON.parse(raw) as MdvConfig;
  return parsed;
}

async function writeConfig(config: MdvConfig): Promise<void> {
  const configPath = getConfigPath();
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

async function resolveServerUrl(serverFromFlag: string | undefined): Promise<string> {
  if (serverFromFlag) {
    return normalizeServerUrl(serverFromFlag);
  }

  const config = await readConfig();
  if (config.remote) {
    return normalizeServerUrl(config.remote);
  }

  throw new Error(
    'No remote server configured. Run `mdv remote set <server-url>` or pass `--server <url>`.'
  );
}

async function runLocalView(options: LocalViewOptions): Promise<void> {
  const rawPath = options.markdownPathArg;

  if (!rawPath) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const markdownPath = await resolveMarkdownPath(rawPath);
  await validateMarkdownPath(markdownPath);
  await assertBuildExists();

  const app = express();

  app.get('/api/markdown', async (_req, res) => {
    try {
      const markdownContent = await fs.readFile(markdownPath, 'utf8');
      res.setHeader('x-md-path', markdownPath);
      res.type('text/plain; charset=utf-8').send(markdownContent);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: `Failed to read markdown: ${message}` });
    }
  });

  app.use(express.static(WEB_DIST_PATH, { index: false }));

  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(WEB_DIST_PATH, 'index.html'));
  });

  const selectedPort = options.port ?? (await getPort({ port: DEFAULT_PORT_RANGE }));
  const server = app.listen(selectedPort, async () => {
    const url = `http://localhost:${selectedPort}`;
    console.log(`mdv serving: ${markdownPath}`);
    console.log(`Open: ${url}`);

    if (options.shouldOpenBrowser) {
      await open(url);
    }
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE' && options.port) {
      console.error(`mdv failed: Port ${options.port} is already in use.`);
      process.exit(1);
      return;
    }

    console.error(`mdv failed: ${error.message}`);
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

async function runPush(options: PushOptions): Promise<void> {
  const rawPath = options.markdownPathArg;
  if (!rawPath) {
    throw new Error('Usage: mdv push <path-to-markdown-file> [--server <url>] [--token <token>]');
  }

  const markdownPath = await resolveMarkdownPath(rawPath);
  await validateMarkdownPath(markdownPath);
  const markdownContent = await fs.readFile(markdownPath, 'utf8');

  const serverUrl = await resolveServerUrl(options.server);
  const config = await readConfig();
  const token = options.token ?? process.env.MDV_TOKEN ?? config.token;

  if (!token) {
    throw new Error('Missing bearer token. Set with `mdv remote pair <server-url> <token>`, `MDV_TOKEN`, or `--token <token>`.');
  }

  const response = await fetch(`${serverUrl}/api/push`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      fileName: path.basename(markdownPath),
      markdown: markdownContent
    })
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Push failed (${response.status}): ${responseText}`);
  }

  let parsed: PushResponse;
  try {
    parsed = JSON.parse(responseText) as PushResponse;
  } catch {
    throw new Error('Push failed: server returned invalid JSON response.');
  }

  if (!parsed.url || !parsed.id) {
    throw new Error('Push failed: server response missing `url` or `id`.');
  }

  console.log(`Pushed: ${markdownPath}`);
  console.log(`ID: ${parsed.id}`);
  console.log(`Public URL: ${parsed.url}`);
}

async function runRemoteSet(options: RemoteSetOptions): Promise<void> {
  if (!options.server) {
    throw new Error('Usage: mdv remote set <server-url>');
  }

  const serverUrl = normalizeServerUrl(options.server);
  const existing = await readConfig();
  const next: MdvConfig = {
    ...existing,
    remote: serverUrl
  };

  await writeConfig(next);
  console.log(`Remote set: ${serverUrl}`);
  console.log(`Config: ${getConfigPath()}`);
}

async function runRemoteShow(): Promise<void> {
  const config = await readConfig();

  const tokenPreview = config.token
    ? `${config.token.slice(0, 4)}...${config.token.slice(-4)}`
    : 'not set';

  if (!config.remote && !config.token) {
    console.log('No remote configured.');
    return;
  }

  console.log(`Remote: ${config.remote ?? 'not set'}`);
  console.log(`Token: ${tokenPreview}`);
}

async function runRemotePair(options: RemotePairOptions): Promise<void> {
  if (!options.server || !options.token) {
    throw new Error('Usage: mdv remote pair <server-url> <token>');
  }

  const serverUrl = normalizeServerUrl(options.server);
  const existing = await readConfig();
  const next: MdvConfig = {
    ...existing,
    remote: serverUrl,
    token: options.token
  };

  await writeConfig(next);
  console.log(`Remote paired: ${serverUrl}`);
  console.log(`Config: ${getConfigPath()}`);
}

async function runRemoteClear(): Promise<void> {
  const configPath = getConfigPath();
  if (!(await fileExists(configPath))) {
    console.log('No remote config found.');
    return;
  }

  await fs.rm(configPath, { force: true });
  console.log(`Remote config cleared: ${configPath}`);
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv.slice(2));

  if (command.type === 'local-view') {
    await runLocalView(command.options);
    return;
  }

  if (command.type === 'push') {
    await runPush(command.options);
    return;
  }

  if (command.type === 'remote-set') {
    await runRemoteSet(command.options);
    return;
  }

  if (command.type === 'remote-pair') {
    await runRemotePair(command.options);
    return;
  }

  if (command.type === 'remote-clear') {
    await runRemoteClear();
    return;
  }

  await runRemoteShow();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`mdv failed: ${message}`);
  process.exit(1);
});
