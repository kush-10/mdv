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

type CliOptions = {
  markdownArg?: string;
  port?: number;
  shouldOpenBrowser: boolean;
};

function printUsage(): void {
  console.error('Usage: mdview <path-to-markdown-file> [--port <number>] [--no-open]');
}

function parseArgs(argv: string[]): CliOptions {
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
    markdownArg: positional[0],
    port,
    shouldOpenBrowser
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
      `Web build not found at ${WEB_DIST_PATH}. Run \`pnpm build\` first.`
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

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const rawPath = options.markdownArg;

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
    console.log(`mdview serving: ${markdownPath}`);
    console.log(`Open: ${url}`);

    if (options.shouldOpenBrowser) {
      await open(url);
    }
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE' && options.port) {
      console.error(`mdview failed: Port ${options.port} is already in use.`);
      process.exit(1);
      return;
    }

    console.error(`mdview failed: ${error.message}`);
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

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`mdview failed: ${message}`);
  process.exit(1);
});
