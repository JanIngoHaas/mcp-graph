# Knowledge Graph MCP

A Model Context Protocol (MCP) server for intelligent exploration and querying of RDF knowledge graphs with semantic search capabilities.

## Overview

This server provides tools for exploring SPARQL endpoints and RDF data sources. It combines traditional SPARQL querying with semantic search using embeddings, allowing users (LLMs / agents) to discover and navigate complex knowledge graphs intuitively.

## Key Features

- **SPARQL Query Execution**: Direct querying of RDF knowledge graphs via SPARQL endpoints
- **Boolean Search**: Search for RDF entities using boolean query syntax
- **URI Inspection**: Detailed exploration of RDF classes and properties with domain/range analysis

## MCP Tools

Once running, the server provides these tools to MCP clients:

1. **`query`** - Execute SPARQL queries against the knowledge graph
2. **`search`** - Search for RDF entities using boolean queries
3. **`inspect`** - Inspection tool that automatically detects URI type and shows appropriate information (classes/properties show domain/range relationships, entities show data connections)

## Installation

```bash
npm i
npm run build
npm run init
npm install -g
```

Now, you can use the following config file in your favourite MCP Client

```json
{
  "mcpServers": {
    "kg-mcp": {
      "command": "npx",
      "args": ["kg-mcp"],
      "env": {
        "SPARQL_ENDPOINT": "https://sparql.dblp.org/sparql",
        "ENDPOINT_ENGINE": "qlever"
      }
    }
  }
}
```

## MCP Client Configuration

Add this to your MCP client configuration:

**Environment Variables:**

- `SPARQL_ENDPOINT`: SPARQL endpoint URL for RDF data exploration; Required
- `ENDPOINT_ENGINE`: The SPARQL Engine powering the endpoint; possible values: 'qlever', 'fallback' (default)
- `LOG_FILE`: Path to log file (optional, logs to stderr if not set)
- `LOG_LEVEL`: Logging level (optional, default: `info`)
- `EMBEDDING_BATCH_SIZE`: Batch size for embedding processing (optional, default: 32)

## License

MIT
