# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the Server

- `npm install` - Install dependencies
- `npm run init` - Initialize embedding model (one-time setup)
- `npm run build` - Compile TypeScript to JavaScript (outputs to dist/)

**Linux/Mac:**
```bash
export SPARQL_ENDPOINT="https://dbpedia.org/sparql"
export ENDPOINT_ENGINE="fallback"  # or "qlever"
export MCP_PORT="3000"  # optional, defaults to 3000
npm run start
```

**Windows PowerShell:**
```powershell
$env:SPARQL_ENDPOINT="https://dbpedia.org/sparql"
$env:ENDPOINT_ENGINE="fallback"
npm run start
```

The server will start on **http://localhost:3000/mcp** (or your configured port).

## Environment Variables

### Required
- `SPARQL_ENDPOINT` - SPARQL endpoint URL for RDF data exploration

### Optional
- `PUBLIC_URL` - Public URL for the server (default: `http://localhost:{MCP_PORT}`)
- `MCP_PORT` - HTTP server port (default: `3000`)
- `SPARQL_TOKEN` - Authentication token for SPARQL endpoint (sent as Bearer token in Authorization header)
- `ENDPOINT_ENGINE` - Engine type for SPARQL endpoint (`qlever` or `fallback`, default: `fallback`)
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
4. **Embedding Helper** (`src/services/EmbeddingHelper.ts`): Uses HuggingFace Qwen3-Embedding-0.6B model for embeddings
5. **Search Service** (`src/services/SearchService.ts`): Provides syntactic search functionality for RDF resources
6. **Inspection Service** (`src/services/InspectionService.ts`): Provides detailed URI inspection capabilities
7. **Path Exploration Service** (`src/services/PathExplorationService.ts`): Discovers relationship paths between entities
8. **Triple Service** (`src/services/TripleService.ts`): Handles triple pattern matching for verify/cite tools
9. **Citation Database** (`src/utils/CitationDatabase.ts`): In-memory storage for citation links
10. **Types** (`src/types.ts`): TypeScript type definitions
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

1. **`query`** - Execute SPARQL queries against the knowledge graph
2. **`search`** - Search for RDF entities using boolean queries
3. **`inspect`** - Unified inspection tool that automatically detects URI type
4. **`path`** - Discover relationship paths between two entities
5. **`verify`** - Verify RDF triples via pattern matching (simple fact-checking)
6. **`cite`** - Generate citation links for verified triples

## Development Notes

- Server creates a new MCP instance per session (following SDK example pattern)
- Each session has its own citation database
- SPARQL queries include filters to exclude OWL and vendor-specific schemas
- AI model initialization is lazy-loaded for performance (tries GPU first, falls back to CPU)
- Logging uses winston (not console.log) to avoid interfering with HTTP responses
- SSE resumability is enabled via `InMemoryEventStore` per session

## Testing

Run tests with:
```bash
npm run test
```

Tests are located in `src/services/*.test.js` and use Vitest.
