BUN ?= bun
MD_FILE ?= README.md
PORT ?=

.PHONY: help install add add-full dev dev-server build run run-server clean

help:
	@printf "Available targets:\n"
	@printf "  make install        Install workspace dependencies (bun)\n"
	@printf "  make add            Install CLI globally (default)\n"
	@printf "  make add-full       Install CLI and server globally\n"
	@printf "  make dev            Build web + run CLI in dev mode\n"
	@printf "  make dev-server     Run hosted server in dev mode\n"
	@printf "  make build          Build web, CLI, and server packages\n"
	@printf "  make run            Run built CLI (MD_FILE=path PORT=8080)\n"
	@printf "  make run-server     Run built hosted server (PORT=8080)\n"
	@printf "  make clean          Remove build artifacts\n"

install:
	$(BUN) install

add:
	$(BUN) add -g ./packages/cli

add-full:
	$(BUN) add -g ./packages/cli
	$(BUN) add -g ./packages/server

dev:
	$(BUN) run dev

dev-server:
	$(BUN) run dev:server

build:
	$(BUN) run build

run:
	$(BUN) run --cwd packages/cli start -- ./$(MD_FILE) --no-open $(if $(PORT),--port $(PORT),)

run-server:
	$(BUN) run --cwd packages/server start -- $(if $(PORT),--port $(PORT),)

clean:
	rm -rf "packages/web/dist" "packages/cli/dist" "packages/server/dist"
