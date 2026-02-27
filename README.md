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
mdv-server --port 4173
```

On first run, the server generates a secure token and prints a pairing command.

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
