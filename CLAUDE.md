# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the Server

- `npm install` - Install dependencies
- `npm run init` - Legacy embedding model predownload (currently unused by runtime tools)
- `npm run build` - Compile TypeScript to JavaScript (outputs to dist/)

**Linux/Mac:**
```bash
export SPARQL_ENDPOINT="https://sparql.dblp.org/sparql"
export ENDPOINT_ENGINE="qlever"  # strongly recommended
export MCP_PORT="3000"  # optional, defaults to 3000
npm run start
```

**Windows PowerShell:**
```powershell
$env:SPARQL_ENDPOINT="https://sparql.dblp.org/sparql"
$env:ENDPOINT_ENGINE="qlever"
npm run start
```

The server will start on **http://localhost:3000/mcp** (or your configured port).
You can also start from `.env.example` and adjust values as needed.

## Environment Variables

### Required
- `SPARQL_ENDPOINT` - SPARQL endpoint URL for RDF data exploration

### Strongly Recommended
- `ENDPOINT_ENGINE` - Engine type for SPARQL endpoint (`qlever` or `fallback`, default: `fallback`)

### Optional
- `PUBLIC_URL` - Public URL for the server (default: `http://localhost:{MCP_PORT}`)
- `MCP_PORT` - HTTP server port (default: `3000`)
- `SPARQL_TOKEN` - Authentication token for SPARQL endpoint (sent as Bearer token in Authorization header)
- `LOG_FILE` - Path to log file (logs to stdout if not set)
- `LOG_LEVEL` - Logging level (default: `info`)
- `EMBEDDING_BATCH_SIZE` - Batch size for embedding processing (default: `32`)
- `CUSTOM_PREFIXES` - Custom RDF URI prefixes, comma-separated (e.g. `dblp:<https://dblp.org/rdf/schema#>`)

## Architecture Overview

This is a Model Context Protocol (MCP) HTTP server that provides graph exploration capabilities for RDF data sources. The architecture consists of:

### Core Components

1. **MCP Server** (`src/server.ts`): Creates and configures the MCP server with tool definitions and handlers
2. **HTTP Entry Point** (`src/index.ts`): Initializes Express HTTP server with StreamableHTTPServerTransport for MCP communication
3. **Query Service** (`src/services/QueryService.ts`): Handles SPARQL query execution with rate limiting
4. **Embedding Helper** (`src/services/EmbeddingHelper.ts`): Legacy embedding helper and predownload script
5. **Search Service** (`src/services/SearchService.ts`): Provides syntactic search functionality for RDF resources
6. **Inspection Service** (`src/services/InspectionService.ts`): Provides detailed URI inspection capabilities
7. **Triple Service** (`src/services/TripleService.ts`): Handles triple pattern matching for fact/cite tools
8. **Query Builder Service** (`src/services/QueryBuilderService.ts`): Structured, explainable query building
9. **Explanation Service** (`src/services/ExplanationService.ts`): Stores and resolves explain steps/links
10. **Citation Database** (`src/utils/CitationDatabase.ts`): In-memory storage for citation links
11. **Utils** (`src/utils/`): Logging, formatting, and citation utilities

### Key Technologies

- **@modelcontextprotocol/sdk**: MCP protocol implementation with HTTP Streamable transport
- **Express**: HTTP server framework
- **@comunica/query-sparql**: SPARQL query engine for RDF data
- **n3**: RDF triple store and utilities
- **TypeScript**: Primary language with ES2020 target

### Transport Architecture

The server uses **HTTP Streamable Transport** (not stdio):
- **POST /mcp**: JSON-RPC requests
- **GET /mcp**: Server-Sent Events (SSE) for notifications
- **DELETE /mcp**: Session termination
- **Session Management**: Multiple concurrent sessions with unique IDs
- **Resumability**: SSE streams can resume after network interruptions using `Last-Event-ID`

### Citation System

Each server instance has its own `CitationDatabase`:
- Citations use human-readable word IDs
- `cite` tool stores triples and returns URLs like `http://localhost:3000/citation/{uuid}`
- Citations are session-scoped and cleaned up when sessions close

## Available MCP Tools

Once running, the server provides these tools:

1. **`query`** - Execute SPARQL queries against the knowledge graph (**legacy**)
2. **`search`** - Search for RDF entities using boolean queries
3. **`inspect`** - Unified inspection tool that automatically detects URI type
4. **`fact`** - Verify/find triples via pattern matching using `_` wildcards
5. **`query_builder`** - Structured explainable/citable query tool
6. **`cite`** - Generate citation links for verified triples
7. **`explain`** - Generate interactive explanation pages with citations and execution steps

## Development Notes

- Server creates a new MCP instance per session (following SDK example pattern)
- Each session has its own citation database
- SPARQL queries include filters to exclude OWL and vendor-specific schemas
- Embedding model predownload exists as a legacy script; runtime tools currently do not call `embed()`
- Logging uses winston (not console.log) to avoid interfering with HTTP responses
- SSE resumability is enabled via `InMemoryEventStore` per session

## Testing

Run tests with:
```bash
npm run test
```

Tests are located in `src/services/*.test.js` and use Vitest.
