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
5. **Database Helper** (`src/services/DatabaseHelper.ts`): Manages SQLite database with vector extensions
6. **Search Service** (`src/services/SearchService.ts`): Combines query, embedding, and database services for semantic search and ontology exploration
7. **Inspection Service** (`src/services/InspectionService.ts`): Provides detailed URI inspection capabilities for classes and properties
8. **Query Constraints** (`src/query_constraints.ts`): Defines SPARQL query filters and constraints
9. **Types** (`src/types.ts`): TypeScript type definitions for the application
10. **Utils** (`src/utils/`): Logging, caching, and formatting utilities

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

1. **`querySparql`** - Execute SPARQL queries against the knowledge graph
2. **`searchOntology`** - Semantic search for RDF ontological constructs using embeddings
3. **`searchAll`** - Full-text search for any RDF entities
4. **`inspectMetadata`** - Detailed inspection of any metadata URI (classes show properties with domain/range, properties show domain-range relationships)
5. **`inspectData`** - Detailed inspection of data/instance URIs (shows incoming/outgoing relationships)

## Planned Improvements

### Agentic Workflow Enhancement

The current tool set requires agents to make too many decisions and context switches. Planned improvements:

#### 1. Unified Search Tool
- **Problem**: Split between `searchOntology` (semantic) and `searchAll` (syntactic) creates cognitive friction
- **Solution**: Combine into single intelligent search that runs both approaches simultaneously
- **Benefits**:
  - Eliminates "which search should I use?" decision
  - Merges and ranks results from multiple methods
  - Auto-categorizes findings (classes, properties, entities)
  - Suggests contextually relevant next steps

#### 2. Context-Aware Inspection
- **Problem**: `inspectMetadata` returns overwhelming property lists without prioritization
- **Solution**: Make inspection results conversation-aware
- **Benefits**:
  - Filter properties by relevance to user's research goal
  - Remember previously explored concepts to avoid repetition
  - Suggest logical next exploration steps based on current findings
  - Progressive disclosure (show top 3-5 relevant items, with "explore more" options)

#### 3. Query Construction Assistant
- **Problem**: Large gap between inspection results and SPARQL query construction
- **Solution**: Add query builder tool that bridges discovery to execution
- **Benefits**:
  - Suggests SPARQL patterns based on inspection results
  - Validates queries before execution
  - Provides natural language query explanations
  - Templates for common query patterns

#### 4. Research Session Context
- **Problem**: Each tool call is isolated, agents lose research thread
- **Solution**: Maintain conversation state and research context
- **Benefits**:
  - Track user's apparent research goal across interactions
  - Avoid re-suggesting already explored paths
  - Connect new findings to previous discoveries
  - Explain significance of results in research context

### Design Philosophy Shift
Transform from **data access tool collection** to **intelligent research assistant** that:
- Understands agent's exploration intent
- Guides discovery rather than overwhelming with options
- Reduces cognitive load while increasing insight quality
- Maintains research continuity across interactions

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
