PNPM ?= pnpm
MD_FILE ?= README.md
PORT ?=

.PHONY: help install add dev dev-server build run run-server clean

help:
	@printf "Available targets:\n"
	@printf "  make install        Install workspace dependencies\n"
	@printf "  make add            Add CLI package globally via pnpm\n"
	@printf "  make dev            Build web + run CLI in dev mode\n"
	@printf "  make dev-server     Run hosted server in dev mode\n"
	@printf "  make build          Build web and CLI packages\n"
	@printf "  make run            Run built CLI (MD_FILE=path PORT=8080)\n"
	@printf "  make run-server     Run built hosted server (PORT=8080)\n"
	@printf "  make clean          Remove build artifacts\n"

install:
	$(PNPM) i

add:
	$(PNPM) add --global ./packages/cli

dev:
	$(PNPM) dev

dev-server:
	$(PNPM) dev:server

build:
	$(PNPM) build

run:
	$(PNPM) -C packages/cli start -- ./$(MD_FILE) --no-open $(if $(PORT),--port $(PORT),)

run-server:
	$(PNPM) -C packages/server start -- $(if $(PORT),--port $(PORT),)

clean:
	rm -rf "packages/web/dist" "packages/cli/dist" "packages/server/dist"
