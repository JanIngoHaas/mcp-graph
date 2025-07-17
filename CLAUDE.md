# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

- `npm install` - Install dependencies
- `npx tsc` - Compile TypeScript to JavaScript (outputs to dist/)
- `node dist/index.js` - Run the compiled MCP server

## Environment Variables

- `MCP_GRAPH_DB_PATH` - Path for persistent database storage (default: `:memory:`)
- `SPARQL_ENDPOINT` - SPARQL endpoint URL for RDF data exploration
- `LLM_BASED_EXAMPLE_QUERY` - Enable LLM-based query generation (default: `false`)

## Architecture Overview

This is a Model Context Protocol (MCP) server that provides graph exploration capabilities for RDF data sources. The architecture consists of:

### Core Components

1. **MCP Server** (`src/server.ts`): Creates and configures the MCP server with tool definitions and handlers
2. **Main Entry Point** (`src/index.ts`): Initializes the server with stdio transport for MCP communication
3. **Exploration Service** (`src/exploration.ts`): Core service that handles RDF graph exploration and analysis

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
- **AI Integration**: Uses HuggingFace models (SmolLM2-1.7B-Instruct for generation, Qwen3-Embedding-0.6B for embeddings)
- **Query Generation**: Generates natural language queries from RDF properties (LLM-based or static)
- **Vector Search**: Semantic similarity search using embeddings with SQLite vector extension
- **Store Conversion**: Converts property maps to N3 RDF stores
- **Database Management**: Automatic directory creation for persistent storage

### Data Models

- `TypeInfo`: Represents RDF types with URI, label, and description
- `PropertyInfo`: Represents RDF properties with domain-range pairs
- `ExplorationOptions`: Configuration for exploration queries

## Development Notes

- The server implements a `search_properties` tool for vector similarity search
- SPARQL queries include filters to exclude OWL and vendor-specific schemas
- AI model initialization is lazy-loaded for performance
- Vector embeddings are processed in batches for better performance
- Console.log statements use console.error to avoid breaking MCP stdio protocol
- Query generation creates 1:1 pairing between queries and descriptions for optimal search granularity

## Query Generation Modes

### Static Mode (`LLM_BASED_EXAMPLE_QUERY=false`, default)
- Generates simple relationship queries: `"Domain --[Property]--> Range"`
- Uses "semantically similar documents" embedding instruction
- Faster, no LLM inference required
- One query per domain-range pair

### LLM Mode (`LLM_BASED_EXAMPLE_QUERY=true`)
- Generates natural language queries using SmolLM2-1.7B-Instruct
- Uses "semantically similar queries" embedding instruction  
- Slower, requires model inference
- One LLM-generated query per domain-range pair