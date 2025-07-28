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

## Installation & Setup

### Docker (Recommended)

**Quick Start:**
```bash
# CPU version
docker-compose up mcp-graph

# GPU version (requires nvidia-docker)
docker-compose --profile cuda up mcp-graph-cuda
```

### Native Installation

**For MCP usage:**
```bash
npm install -g .
```

This installs the `sparql-mcp` command globally. To initialize the database:
```bash
npm run init
```

## MCP Tools

Once running, the server provides these tools to MCP clients:

1. **`makeQuery`** - Execute SPARQL queries against the knowledge graph
2. **`searchOntology`** - Semantic search for RDF ontological constructs (i.e. metadata) using embeddings
3. **`searchAll`** - Full-text search for any RDF entities
4. **`inspectMetadata`** - Detailed inspection of any metadata URI (classes show properties with domain/range, properties show domain-range relationships)

## MCP Server Configuration

### Docker Configuration

The Docker setup handles all environment variables automatically. For custom endpoints:

```bash
# Edit docker-compose.yml environment section
SPARQL_ENDPOINT: "https://your-endpoint.org/sparql"
```

### Native Configuration

For native installation, add this to your MCP client configuration:

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

**Environment Variables:**

- `DB_PATH`: Database storage path (`:cache:` for temporary, `./data/ontology.db` for persistent)
- `SPARQL_ENDPOINT`: SPARQL endpoint URL for RDF data exploration
- `LOG_FILE`: Path to log file (optional, logs to stderr if not set)
- `LOG_LEVEL`: Logging level (optional, default: `info`)
- `EMBEDDING_BATCH_SIZE`: Batch size for embedding processing (optional, default: 32)

## Development & Testing

### Docker Development
```bash
# Development mode with hot reload
docker-compose --profile dev up mcp-graph-dev
```

### Native Development
```bash
npm install
npm test          # Run tests
npm run build     # Compile TypeScript
npm run start     # Build and run
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
