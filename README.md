# @hasna/microservices

Mini business apps for AI agents - invoices, contacts, bookkeeping and more, each with its own SQLite database

[![npm](https://img.shields.io/npm/v/@hasna/microservices)](https://www.npmjs.com/package/@hasna/microservices)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/microservices
```

## CLI Usage

```bash
microservices --help
```

- `microservices install`
- `microservices remove`
- `microservices list`
- `microservices search`
- `microservices info`
- `microservices categories`
- `microservices run`
- `microservices ops`

## MCP Server

```bash
microservices-mcp
```

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service microservices
cloud sync pull --service microservices
```

## Data Directory

Data is stored in `~/.hasna/microservices/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
