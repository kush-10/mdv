# mdv

mdv is a local-first markdown viewer. Open `.md` files in a clean reading UI, then push them to your self-hosted server to get a public URL.

## Installation

```bash
git clone https://github.com/kush-10/mdv
cd mdv
pnpm i
pnpm build
```

Optional global commands:

```bash
pnpm add --global ./packages/cli
pnpm add --global ./packages/server
```

## Usage

### 1) View a local markdown file

```bash
mdview README.md
```

### 2) Start the self-hosted server

```bash
mdv-server --port 4173
```

On first run, the server generates a secure token and prints a pairing command.

### 3) Pair your client

```bash
mdview remote pair https://docs.example.com <token>
```

### 4) Push a markdown file

```bash
mdview push README.md
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
