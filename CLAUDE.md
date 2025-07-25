# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

- `npm install` - Install dependencies
- `npx tsc` - Compile TypeScript to JavaScript (outputs to dist/)
- `node dist/index.js [dbPath] [sparqlEndpoint]` - Run the compiled MCP server with optional arguments

## Server Startup

**Basic in-memory setup:**
```bash
npx tsc && node dist/index.js
```

**With persistent database:**
```bash
npx tsc && node dist/index.js ./data/ontology.db
```

**With SPARQL endpoint (triggers automatic exploration):**
```bash
npx tsc && node dist/index.js https://dbpedia.org/sparql
```

**With both database path and SPARQL endpoint:**
```bash
npx tsc && node dist/index.js ./data/ontology.db https://dbpedia.org/sparql
```

**Using environment variables (Linux/Mac):**
```bash
export MCP_GRAPH_DB_PATH="./data/ontology.db"
export SPARQL_ENDPOINT="https://dbpedia.org/sparql"
npx tsc && node dist/index.js
```

**Using environment variables (Windows PowerShell):**
```powershell
$env:MCP_GRAPH_DB_PATH="./data/ontology.db"
$env:SPARQL_ENDPOINT="https://dbpedia.org/sparql"
npx tsc; node dist/index.js
```

**Using environment variables (Windows Command Prompt):**
```cmd
set MCP_GRAPH_DB_PATH=./data/ontology.db
set SPARQL_ENDPOINT=https://dbpedia.org/sparql
npx tsc && node dist/index.js
```

**Command Line Arguments:**
- If one argument starts with "http" → treated as SPARQL endpoint
- If one argument doesn't start with "http" → treated as database path  
- If two arguments → first is database path, second is SPARQL endpoint

## Environment Variables

- `MCP_GRAPH_DB_PATH` - Path for persistent database storage (default: `:memory:`)
- `SPARQL_ENDPOINT` - SPARQL endpoint URL for RDF data exploration
- `EMBEDDING_BATCH_SIZE` - Batch size for embedding processing (default: `32`)

## Architecture Overview

This is a Model Context Protocol (MCP) server that provides graph exploration capabilities for RDF data sources. The architecture consists of:

### Core Components

1. **MCP Server** (`src/server.ts`): Creates and configures the MCP server with tool definitions and handlers
2. **Main Entry Point** (`src/index.ts`): Initializes the server with stdio transport for MCP communication
3. **Query Service** (`src/services/QueryService.ts`): Handles SPARQL query execution with rate limiting
4. **Embedding Service** (`src/services/EmbeddingService.ts`): Uses HuggingFace Qwen3-Embedding-0.6B model for embeddings
5. **Database Service** (`src/services/DatabaseService.ts`): Manages SQLite database with vector extensions
6. **Search Service** (`src/services/SearchService.ts`): Combines query, embedding, and database services for semantic search
7. **Inspection Service** (`src/services/InspectionService.ts`): Provides detailed URI inspection capabilities for classes and properties
8. **Exploration Service** (`src/exploration.ts`): Core service that handles RDF graph exploration and analysis

### Key Technologies

- **@modelcontextprotocol/sdk**: MCP protocol implementation
- **@comunica/query-sparql**: SPARQL query engine for RDF data
- **n3**: RDF triple store and utilities
- **@huggingface/transformers**: AI models for text generation and embeddings
- **better-sqlite3 + sqlite-vec**: Vector database for semantic search
- **TypeScript**: Primary language with ES2020 target

### Exploration Service Features

The `ExplorationService` class provides:
- **Property Discovery**: Queries RDF sources to discover properties with domain/range relationships
- **Batch Processing**: Handles large datasets with configurable batch sizes and progress callbacks
- **AI Integration**: Uses HuggingFace Qwen3-Embedding-0.6B model for semantic embeddings
- **Query Generation**: Generates static relationship queries from RDF properties
- **Vector Search**: Semantic similarity search using embeddings with SQLite vector extension
- **Store Conversion**: Converts property maps to N3 RDF stores
- **Database Management**: Automatic directory creation for persistent storage

### Data Models

- `TypeInfo`: Represents RDF types with URI, label, and description
- `PropertyInfo`: Represents RDF properties with domain-range pairs
- `ExplorationOptions`: Configuration for exploration queries

## Available MCP Tools

Once running, the server provides these tools:

1. **`makeQuery`** - Execute SPARQL queries against the knowledge graph
2. **`searchOntology`** - Semantic search for RDF ontological constructs using embeddings
3. **`searchAll`** - Full-text search for any RDF entities
4. **`inspectURI`** - Detailed inspection of any URI (classes show properties with domain/range, properties show domain-range relationships)

## Development Notes

- The server implements vector similarity search with automatic ontology exploration
- SPARQL queries include filters to exclude OWL and vendor-specific schemas
- AI model initialization is lazy-loaded for performance (tries GPU first, falls back to CPU)
- Vector embeddings are processed in batches for better performance
- Console.log statements use console.error to avoid breaking MCP stdio protocol
- Query generation creates 1:1 pairing between queries and descriptions for optimal search granularity
- Uses static relationship queries in the format: `"Domain --[Property]--> Range"`
- Uses "semantically similar documents" embedding instruction
- First run with a new SPARQL endpoint will take time for ontology exploration and embedding generation
- Database directories are created automatically if they don't exist

