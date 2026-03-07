# mdv

`mdv` is a local-first Markdown viewer with an optional server mode for sharing public links.

- Read Markdown locally in a clean browser UI.
- Run `mdv-server` to receive pushes and host public document URLs.
- Protect admin operations with HTTP Basic Auth.

## What You Get

- `mdv`: local viewing + push workflows.
- `mdv-server`: self-hosted sharing service.
- Public document routes at `/d/<id>`.
- Admin page at `/admin` (lists files, supports permanent delete, shows current server token/source).

## Install

```bash
git clone https://github.com/kush-10/mdv
cd mdv
bun run setup
```

`setup` installs dependencies, builds all packages, and installs both global commands (`mdv`, `mdv-server`).

If your npm global prefix is not writable (common on Linux), install falls back to `~/.local`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Local Mode (No Server)

Open a Markdown file directly:

```bash
mdv README.md
```

Useful flags:

```bash
mdv README.md --port 4174 --no-open
```

## Server Mode (Share Links)

Server mode is for publishing Markdown to a self-hosted endpoint and getting shareable URLs.

### 1) Start the server

```bash
export MDV_ADMIN_USERNAME=admin
export MDV_ADMIN_PASSWORD='use-a-strong-password'
mdv-server --port 4173
```

Notes:

- Admin credentials are required to boot.
- On first run (without `MDV_SERVER_TOKEN` and without an existing token file), a secure token is generated.
- Data is stored in `.mdv-server-data` by default.

### 2) Pair your client with the server token

```bash
mdv remote pair https://docs.example.com <token>
```

This stores remote + token in your local mdv config.

### 3) Push Markdown to get a public URL

```bash
mdv push README.md
```

Example result:

```text
https://docs.example.com/d/<id>
```

Push behavior:

- Pushing the same local file path to the same remote updates the existing published page instead of creating a new one.
- If that page was deleted from admin, the next push creates a new page and remaps automatically.

## Viewer Shortcuts

- `Cmd+K` (macOS) or `Ctrl+K` (Windows/Linux): open share overlay with QR code and copyable link.

## Token Management

```bash
mdv-server token show
mdv-server token rotate
```

Rotate if a token leaks. Existing clients must pair again after rotation.

## Docker (Recommended for Hosting)

### 1) Configure environment

```bash
cp .env.example .env
```

Set strong values in `.env`:

```dotenv
MDV_SERVER_TOKEN=<long-random-token>
MDV_ADMIN_USERNAME=<admin-username>
MDV_ADMIN_PASSWORD=<strong-password>
```

### 2) Start with Docker Compose

```bash
docker compose up -d --build
```

Server is available at `http://localhost:4173`. Persistent data is stored in Docker volume `mdv_data` mounted at `/data`.

### 3) Inspect/rotate token inside the container

```bash
docker compose exec mdv-server mdv-server token show --data-dir /data
docker compose exec mdv-server mdv-server token rotate --data-dir /data
```

If you set `MDV_SERVER_TOKEN` in `.env`, token source reports as `env`.

## Admin Page

- URL: `http://<host>:4173/admin`
- Auth: HTTP Basic Auth (`MDV_ADMIN_USERNAME` / `MDV_ADMIN_PASSWORD`)
- Shows: uploaded files, IDs, timestamps, delete actions, plus current server token and token source
- Delete is permanent (markdown + metadata are removed immediately)

## Security Notes

- Put the server behind HTTPS for any internet-facing deployment.
- Use long random values for `MDV_SERVER_TOKEN` and admin password.
- Rotate token immediately if exposed.

## CLI Reference

`mdv`:

```bash
mdv <path-to-markdown-file> [--port <number>] [--no-open]
mdv push <path-to-markdown-file> [--server <url>] [--token <token>]
mdv remote set <server-url>
mdv remote pair <server-url> <token>
mdv remote clear
mdv remote show
```

`mdv-server`:

```bash
mdv-server [--port <number>] [--data-dir <path>]
mdv-server token show [--data-dir <path>]
mdv-server token rotate [--data-dir <path>]
```
