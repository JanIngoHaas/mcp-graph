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

## MCP Tools

Once running, the server provides these tools to MCP clients:

1. **`querySparql`** - Execute SPARQL queries against the knowledge graph
2. **`searchOntology`** - Semantic search for RDF ontological constructs (i.e. metadata) using embeddings
3. **`searchAll`** - Full-text search for any RDF entities
4. **`inspectMetadata`** - Detailed inspection of any metadata URI (classes show properties with domain/range, properties show domain-range relationships)

# Installation & Setup

<!-- ## Docker (Recommended)

**Quick Start:**

```json
{
  "mcpServers": {
    "sparql-mcp": {
      "command": "docker-compose",
      "arg": ["up", "--build", "-d"],
      "env": {
        "SPARQL_ENDPOINT": "https://dbpedia.org/sparql"
      }
    }
  }
}
``` -->

## Native Installation - for development

**For MCP usage:**

### Linux / MacOS

```bash
export SPARQL_ENDPOINT="https://your-endpoint.org/sparql"
npm install
npm run init
npm test
npm install -g
```

### Windows

```ps
$env:SPARQL_ENDPOINT="https://dbpedia.org/sparql"
npm install
npm run init
npm test
npm install -g
```

Now, you can use the following config file in your favourite MCP Client

```json
{
  "mcpServers": {
    "sparql-mcp": {
      "command": "npx",
      "arg": ["sparql-mcp"],
      "env": {
        "SPARQL_ENDPOINT": "https://dbpedia.org/sparql",
        "DB_PATH": ":cache:"
      }
    }
  }
}
```

## MCP Server Configuration

### Docker Configuration

The Docker setup handles all environment variables automatically. For custom endpoints:

### Native Configuration

For native installation, add this to your MCP client configuration:

**Environment Variables:**

- `DB_PATH`: Database storage path (optional, default: `:cache:` to automatically choose a cache path)
- `SPARQL_ENDPOINT`: SPARQL endpoint URL for RDF data exploration; Required
- `LOG_FILE`: Path to log file (optional, logs to stderr if not set)
- `LOG_LEVEL`: Logging level (optional, default: `info`)
- `EMBEDDING_BATCH_SIZE`: Batch size for embedding processing (optional, default: 32)

## Architecture

Built with TypeScript and using:

- **@modelcontextprotocol/sdk**: MCP protocol implementation
- **@comunica/query-sparql**: SPARQL query engine for RDF data
- **@huggingface/transformers**: AI embeddings for semantic search
- **better-sqlite3 + sqlite-vec**: Vector database for similarity search
- **n3**: RDF triple store and utilities

## License

MIT
