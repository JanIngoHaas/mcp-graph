# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the Server

### Docker (Recommended)

**CPU version:**
```bash
docker-compose up mcp-graph
```

**GPU version (requires nvidia-docker):**
```bash
docker-compose --profile cuda up mcp-graph-cuda
```

**Development mode:**
```bash
docker-compose --profile dev up mcp-graph-dev
```

### Native Development

- `npm install` - Install dependencies
- `npx tsc` - Compile TypeScript to JavaScript (outputs to dist/)

**Linux/Mac:**
```bash
export DB_PATH="./data/ontology.db"
export SPARQL_ENDPOINT="https://dbpedia.org/sparql"
npx tsc && node dist/index.js
```

**Windows PowerShell:**
```powershell
$env:DB_PATH="./data/ontology.db"
$env:SPARQL_ENDPOINT="https://dbpedia.org/sparql"
npx tsc; node dist/index.js
```

## Environment Variables

- `DB_PATH` - Path for persistent database storage (default: `:memory:`)
- `SPARQL_ENDPOINT` - SPARQL endpoint URL for RDF data exploration
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
- **@huggingface/transformers**: AI models for text generation and embeddings
- **TypeScript**: Primary language with ES2020 target


### Data Models

- `ResourceResult`: Represents search results with URI, label, and description

## Available MCP Tools

Once running, the server provides these tools:

1. **`querySparql`** - Execute SPARQL queries against the knowledge graph
2. **`searchAll`** - Full-text search for any RDF entities
3. **`inspect`** - Unified inspection tool that automatically detects URI type and shows appropriate information (classes/properties show domain/range relationships, entities show data connections)

## Planned Improvements

### Agentic Workflow Enhancement

The current tool set could benefit from improvements to reduce cognitive load on agents:

#### 1. Context-Aware Inspection
- **Problem**: `inspect` tool can return overwhelming property lists without prioritization
- **Solution**: Make inspection results conversation-aware
- **Benefits**:
  - Filter properties by relevance to user's research goal
  - Progressive disclosure (show top 3-5 relevant items, with "explore more" options)

#### 2. Query Construction Assistant
- **Problem**: Large gap between inspection results and SPARQL query construction
- **Solution**: Add query builder tool that bridges discovery to execution
- **Benefits**:
  - Suggests SPARQL patterns based on inspection results
  - Validates queries before execution
  - Provides natural language query explanations
  - Templates for common query patterns

## Development Notes

- SPARQL queries include filters to exclude OWL and vendor-specific schemas
- AI model initialization is lazy-loaded for performance (tries GPU first, falls back to CPU)
- Console.log statements use console.error to avoid breaking MCP stdio protocol
