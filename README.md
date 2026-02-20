# mdv - Local MD Viewer

View a local markdown file in a clean browser reading layout.

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
```

### Options

- `-p, --port <number>`: Use a specific port instead of auto-selecting one.
- `--no-open`: Start the server without opening the browser.

## Local Development

```bash
pnpm i
pnpm dev
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
- Press `Ctrl+C` to shut down cleanly.
