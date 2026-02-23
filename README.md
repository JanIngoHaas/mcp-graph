# Knowledge Graph MCP Server

MCP server for RDF/SPARQL knowledge graph exploration, verification, and explainable answers.

## Transport

- Uses **MCP Streamable HTTP** only (`/mcp` on POST/GET/DELETE).
- **Stdio transport is not supported** in this project.

## MCP Tools

Current tool names exposed by the server:

1. `query` - Run raw SPARQL queries (**legacy**; prefer `query_builder`/`fact` for explainable and citable results).
2. `search` - Boolean text search over graph resources.
3. `inspect` - Inspect a URI (class/property/entity).
4. `fact` - Verify/find triples with `_` wildcards.
5. `query_builder` - Structured, explainable/citable query construction.
6. `cite` - Activate a citation key into a user-facing source link.
7. `explain` - Create an interactive explanation page with citations and steps.

## Quick Start

```bash
npm install
```

Create `.env` (you can copy from `.env.example`):

```env
# Required: SPARQL endpoint URL for RDF data exploration
SPARQL_ENDPOINT=https://sparql.dblp.org/sparql

# Strongly recommended: qlever
ENDPOINT_ENGINE=qlever
```

Start server:

```bash
npm run start
```

Default MCP endpoint: `http://localhost:3000/mcp`

Legacy model predownload (currently unused by runtime tools):

```bash
npm run init
```

## Environment Variables

- Required:
  - `SPARQL_ENDPOINT`: SPARQL endpoint URL.
- Strongly recommended:
  - `ENDPOINT_ENGINE`: `qlever` or `fallback` (defaults to `fallback`).
- Optional:
  - `MCP_PORT`: HTTP port (default `3000`).
  - `PUBLIC_URL`: Public base URL used in generated links (default `http://localhost:{MCP_PORT}`).
  - `SPARQL_TOKEN`: Bearer token for authenticated endpoints.
  - `LOG_FILE`: Log file path (if unset, logs go to console).
  - `LOG_LEVEL`: `debug`, `info`, `warn`, `error` (default `info`).
  - `EMBEDDING_BATCH_SIZE`: Embedding batch size (default `32`).
  - `CUSTOM_PREFIXES`: Prefix mappings, e.g. `dblp:<https://dblp.org/rdf/schema#>,my:<http://example.com/>`.

## MCP Client Configuration

Example HTTP config:

```json
{
  "mcpServers": {
    "kg-mcp": {
      "url": "http://localhost:3000/mcp",
      "transport": "http"
    }
  }
}
```

## Scripts

- `npm run build` - Compile TypeScript.
- `npm run start` - Build and start the HTTP server.
- `npm run test` - Build and run tests.
- `npm run init` - Legacy model predownload (currently unused by runtime tools).

## License

MIT
