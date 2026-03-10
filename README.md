# mdv

`mdv` is a lightweight Markdown app: open `.md` files, read them in a clean interface, and optionally share pages through your own self-hosted server.

## Install Once

```bash
git clone https://github.com/kush-10/mdv
cd mdv
bun run setup
```

Optional (for one-click PDF export):

```bash
bunx playwright install chromium
```

## Everyday Use

Open any Markdown file:

```bash
mdv README.md
```

Useful options:

```bash
mdv README.md --port 4174 --no-open
```

In the viewer:

- Top-left `home` icon goes back to the app home page.
- Pin/lock chip shows whether the page is `pinned` (on home) or `private` (unlisted).
- Share button opens QR + copy-link dialog.
- PDF button downloads a rendered PDF.
- Theme button toggles light/dark.
- Bottom GitHub icon links to this repository.

## Share Mode (Optional)

If you want public links (`/d/<id>`), run `mdv-server`.

1) Start the server

```bash
export MDV_ADMIN_USERNAME=admin
export MDV_ADMIN_PASSWORD='use-a-strong-password'
mdv-server --port 4173
```

2) Pair your client with the server token

```bash
mdv remote pair https://docs.example.com <token>
```

3) Push a file and get a shareable URL

```bash
mdv push README.md
```

Pushing the same local file updates the same published page unless that page was deleted.

## Pages in Server Mode

- `/` Home page: pinned links only.
- `/d/<id>` Markdown reader page.
- `/admin` Admin page (HTTP Basic Auth required).

Admin lets you create pages, pin/unpin them, and delete permanently.

## Data Location

- Default data dir: `.mdv-server-data`
- Docs are stored under: `.mdv-server-data/docs`

Back up that directory if you need persistence.

## Docker Quick Start

```bash
cp .env.example .env
docker compose up -d --build
```

Set strong values in `.env`:

- `MDV_SERVER_TOKEN`
- `MDV_ADMIN_USERNAME`
- `MDV_ADMIN_PASSWORD`

Server default URL: `http://localhost:4173`

## Security Basics

- Use HTTPS for internet-facing deployments.
- Keep token/admin password long and random.
- Rotate token immediately if leaked:

```bash
mdv-server token rotate
```

## Command Quick Reference

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

## Icon Attribution

- Favicon icon: "Files" by Dighital from Flaticon: https://www.flaticon.com/free-icon/files_3301750
- Flaticon marks this asset as free with attribution.
