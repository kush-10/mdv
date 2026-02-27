# mdv - Local + Public Markdown Viewer
View a local markdown file in a clean browser reading layout, then push it to a self-hosted server for public sharing.

## Installation

### From Source

```bash
git clone https://github.com/kush-10/mdv
cd mdv
pnpm i
pnpm build
```

### Install as Global CLI (from this repo)

```bash
pnpm add --global ./packages/cli
```

After that, `mdview` is available globally on your machine.

If you also want to run the hosted server as a global command:

```bash
pnpm add --global ./packages/server
```

If `mdview` is still not found, ensure PNPM home is in your shell PATH:

```bash
source ~/.zshrc
```

## Usage

```bash
# Open a markdown file
mdview README.md

# Use a custom port
mdview docs/guide.md -p 8080

# Don't auto-open browser
mdview README.md --no-open

# Pair once with server URL + token
mdview remote pair http://localhost:4173 your-token

# Push a markdown file (token read from .mdv/config.json)
mdview push README.md

# Optional override token per-command
MDV_TOKEN=another-token mdview push README.md
```

### Options

- `-p, --port <number>`: Use a specific port instead of auto-selecting one.
- `--no-open`: Start the server without opening the browser.

### Push + Remote Commands

- `mdview remote set <server-url>`: Save a default server URL to `.mdv/config.json`.
- `mdview remote pair <server-url> <token>`: Save both remote server URL and bearer token to `.mdv/config.json`.
- `mdview remote clear`: Remove saved remote/token from `.mdv/config.json`.
- `mdview remote show`: Print configured server URL and token status.
- `mdview push <file.md> [--server <url>] [--token <token>] [--slug <slug>]`: Upload markdown to the remote server.

`mdview push` resolves token in this order: `--token`, `MDV_TOKEN`, then `.mdv/config.json`.

## Self-Hosted Server

Build web + server first:

```bash
pnpm build
```

Start the server (first run auto-generates and persists a secure token):

```bash
pnpm -C packages/server start -- --port 4173
```

On first run, copy the printed pairing command and run it on your client machine.

You can inspect or rotate server token later:

```bash
pnpm -C packages/server start -- token show
pnpm -C packages/server start -- token rotate
```

After rotating, restart the server and re-run `mdview remote pair ...` on clients.

If `MDV_SERVER_TOKEN` is set, it overrides persisted token file for that server run.

Then push from any project:

```bash
mdview remote pair http://localhost:4173 your-token
mdview push README.md
```

Public docs are available at:

```bash
http://localhost:4173/d/<slug>
```

## Local Development

```bash
pnpm i
pnpm dev
```

### Make Shortcuts

```bash
# Show all available targets
make help

# Install deps
make install

# Add mdview globally with pnpm
make add

# Build web + CLI + server
make build

# Run built CLI against README.md
make run

# Run hosted server (auto token generation on first run)
make run-server

# Run built CLI against a specific file/port
make run MD_FILE=docs/guide.md PORT=8080
```

## Build + Run without global link

```bash
pnpm build
pnpm -C packages/cli start -- ./README.md
```

## Notes

- Requires Node.js `18+`.
- The CLI serves the built web app from `packages/web/dist`.
- `GET /api/markdown` returns the markdown content for the React app.
- Live refresh is enabled by default and polls for changes every `800ms`.
- Press `Ctrl+C` to shut down cleanly.
- Hosted server stores pushed docs in `.mdv-server-data/docs` by default.
- Hosted server token is persisted at `.mdv-server-data/server-token` by default.
