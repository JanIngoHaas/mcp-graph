# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the Server

- `npm install` - Install dependencies
- `npx tsc` - Compile TypeScript to JavaScript (outputs to dist/)

**Linux/Mac:**
```bash
export SPARQL_ENDPOINT="https://dbpedia.org/sparql"
export ENDPOINT_ENGINE="fallback"  # or "qlever"
npx tsc && node dist/index.js
```

**Windows PowerShell:**
```powershell
$env:SPARQL_ENDPOINT="https://dbpedia.org/sparql"
$env:ENDPOINT_ENGINE="fallback"  # or "qlever"
npx tsc; node dist/index.js
```

## Environment Variables

- `SPARQL_ENDPOINT` - SPARQL endpoint URL for RDF data exploration
- `ENDPOINT_ENGINE` - Engine type for SPARQL endpoint (`qlever` or `fallback`, default: `fallback`)
- `LOG_FILE` - Path to log file (optional, logs to stderr if not set)
- `LOG_LEVEL` - Logging level (optional, default: `info`)
- `EMBEDDING_BATCH_SIZE` - Batch size for embedding processing (default: `32`)

## Architecture Overview

This is a Model Context Protocol (MCP) server that provides graph exploration capabilities for RDF data sources. The architecture consists of:

### Core Components

1. **MCP Server** (`src/server.ts`): Creates and configures the MCP server with tool definitions and handlers
2. **Main Entry Point** (`src/index.ts`): Initializes the server with stdio transport for MCP communication
3. **Query Service** (`src/services/QueryService.ts`): Handles SPARQL query execution with rate limiting
4. **Embedding Helper** (`src/services/EmbeddingHelper.ts`): Uses HuggingFace Qwen3-Embedding-0.6B model for embeddings
5. **Search Service** (`src/services/SearchService.ts`): Provides syntactic search functionality for RDF resources
6. **Inspection Service** (`src/services/InspectionService.ts`): Provides detailed URI inspection capabilities for classes and properties
7. **Types** (`src/types.ts`): TypeScript type definitions for the application
8. **Utils** (`src/utils/`): Logging and formatting utilities

### Key Technologies

- **@modelcontextprotocol/sdk**: MCP protocol implementation
- **@comunica/query-sparql**: SPARQL query engine for RDF data
- **n3**: RDF triple store and utilities
- **TypeScript**: Primary language with ES2020 target



## Available MCP Tools

Once running, the server provides these tools:

1. **`query`** - Execute SPARQL queries against the knowledge graph
2. **`search`** - Search for RDF entities using boolean queries
3. **`inspect`** - Unified inspection tool that automatically detects URI type and shows appropriate information (classes/properties show domain/range relationships, entities show data connections)


## Development Notes

- SPARQL queries include filters to exclude OWL and vendor-specific schemas
- AI model initialization is lazy-loaded for performance (tries GPU first, falls back to CPU)
- Console.log statements use console.error to avoid breaking MCP stdio protocol
