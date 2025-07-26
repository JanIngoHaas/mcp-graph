# MCP Graph Explorer

A Model Context Protocol (MCP) server for intelligent exploration and querying of RDF knowledge graphs with semantic search capabilities.

## Overview

This server provides tools for exploring SPARQL endpoints and RDF data sources. It combines traditional SPARQL querying with semantic search using embeddings, allowing users (LLMs / agents) to discover and navigate complex knowledge graphs intuitively.

## Key Features

- **SPARQL Query Execution**: Direct querying of RDF knowledge graphs via SPARQL endpoints
- **Semantic Search**: AI-powered semantic search using Qwen3 0.6B embeddings for ontology discovery
- **URI Inspection**: Detailed exploration of RDF classes and properties with domain/range analysis
- **Automatic Ontology Exploration**: Discovers and indexes ontological structures from SPARQL endpoints
- **Vector Database**: Persistent storage with SQLite and vector extensions for fast similarity search

## Installation

**For MCP usage:**

```bash
npm install -g .
```

This installs the `sparql-mcp` command globally, making it available system-wide without hardcoded paths.

## MCP Tools

Once running, the server provides these tools to MCP clients:

1. **`makeQuery`** - Execute SPARQL queries against the knowledge graph
2. **`searchOntology`** - Semantic search for RDF ontological constructs (i.e. metadata) using embeddings
3. **`searchAll`** - Full-text search for any RDF entities
4. **`inspectMetadata`** - Detailed inspection of any metadata URI (classes show properties with domain/range, properties show domain-range relationships)

## MCP Server Configuration

After global installation, add this to your MCP client configuration:

```json
{
  "mcpServers": {
    "sparql-mcp": {
      "command": "sparql-mcp",
      "env": {
        "DB_PATH": ":cache:",
        "SPARQL_ENDPOINT": "https://dbpedia.org/sparql"
      }
    }
  }
}
```

This configuration works cross-platform (Windows, Mac, Linux) with no hardcoded paths.

**Environment Variables:**

- `DB_PATH`: Database storage path (`:cache:` for temporary cache storage)
- `SPARQL_ENDPOINT`: SPARQL endpoint URL for RDF data exploration
- `LOG_FILE`: Path to log file (optional, logs to stderr if not set)
- `LOG_LEVEL`: Logging level (optional, default: `info`)
- `EMBEDDING_BATCH_SIZE`: Batch size for embedding processing (optional, default: 32)

## Testing

To run tests:

1. Install dependencies:

   ```bash
   npm install
   ```

2. Run tests:
   ```bash
   npm test
   ```

## Architecture

Built with TypeScript and using:

- **@modelcontextprotocol/sdk**: MCP protocol implementation
- **@comunica/query-sparql**: SPARQL query engine for RDF data
- **@huggingface/transformers**: AI embeddings for semantic search
- **better-sqlite3 + sqlite-vec**: Vector database for similarity search
- **n3**: RDF triple store and utilities

## License

MIT
