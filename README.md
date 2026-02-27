# mdv

mdv is a local-first markdown viewer. Open `.md` files in a clean reading UI, then push them to your self-hosted server to get a public URL.

## Installation

```bash
git clone https://github.com/kush-10/mdv
cd mdv
bun run setup
```

`setup` installs dependencies, builds all packages, and installs both global commands (`mdv`, `mdv-server`).

Optional global install command:

```bash
# Install both mdv and mdv-server
bun run install:global
```

These scripts use Bun for workspace install/build, then install binaries globally via npm so `mdv` and `mdv-server` are available on your PATH.

On Linux, if your global npm prefix is not writable, install falls back to `~/.local` automatically.

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Usage

### 1) View a local markdown file

```bash
mdv README.md
```

### 2) Start the self-hosted server

```bash
export MDV_ADMIN_USERNAME=admin
export MDV_ADMIN_PASSWORD='use-a-strong-password'
mdv-server --port 4173
```

On first run, the server generates a secure token and prints a pairing command.
Admin credentials are required and protect `/admin` and `/api/admin/files` using HTTP Basic Auth.

### 3) Pair your client

```bash
mdv remote pair https://docs.example.com <token>
```

### 4) Push a markdown file

```bash
mdv push README.md
```

The server returns a random public URL like:

```bash
https://docs.example.com/d/<id>
```

### Token management

```bash
mdv-server token show
mdv-server token rotate
```

## Docker

1) Create your env file:

```bash
cp .env.example .env
```

2) Set strong secrets in `.env`:

```dotenv
MDV_SERVER_TOKEN=<long-random-token>
MDV_ADMIN_USERNAME=<admin-username>
MDV_ADMIN_PASSWORD=<strong-password>
```

3) Run with Docker Compose:

```bash
docker compose up --build -d
```

The server runs on `http://localhost:4173` and stores data in a Docker volume.

## Admin page

- URL: `http://<host>:4173/admin`
- Auth: HTTP Basic Auth (`MDV_ADMIN_USERNAME` / `MDV_ADMIN_PASSWORD`)
- View: uploaded file name, document id, created/updated timestamps, and public links

## Public deployment security notes

- Always run behind HTTPS (reverse proxy or managed TLS).
- Use long random secrets for `MDV_SERVER_TOKEN` and admin password.
- Rotate tokens with `mdv-server token rotate` if leaked.
