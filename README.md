# Knowledge Graph MCP Server

A Model Context Protocol (MCP) HTTP server for intelligent exploration and querying of RDF knowledge graphs with semantic search capabilities.

## Overview

This server provides tools for exploring SPARQL endpoints and RDF data sources via HTTP. It combines traditional SPARQL querying with semantic search using embeddings, allowing LLMs and agents to discover and navigate complex knowledge graphs intuitively.

## Key Features

- **HTTP Streamable Transport**: MCP server accessible via HTTP with SSE support for real-time notifications
- **SPARQL Query Execution**: Direct querying of RDF knowledge graphs via SPARQL endpoints
- **Boolean Search**: Search for RDF entities using boolean query syntax
- **URI Inspection**: Detailed exploration of RDF classes and properties with domain/range analysis
- **Path Discovery**: Find relationship paths between entities
- **Citation System**: Generate verifiable citation links for RDF triples

## MCP Tools

Once running, the server provides these tools to MCP clients:

1. **`query`** - Execute SPARQL queries against the knowledge graph
2. **`search`** - Search for RDF entities using boolean queries
3. **`inspect`** - Unified inspection tool that automatically detects URI type and shows appropriate information
4. **`path`** - Discover relationship paths between two entities
5. **`verify`** - Verify RDF triples via pattern matching (simple fact-checking)
6. **`cite`** - Generate citation links for verified triples (for user reference)

## Installation

```bash
npm install
npm run init    # Initialize embedding model
npm run build   # Compile TypeScript
```

## Running the Server

```bash
export SPARQL_ENDPOINT="https://dbpedia.org/sparql"
export ENDPOINT_ENGINE="fallback"
npm run start
```

The server will start on **http://localhost:3000/mcp** by default.

## Environment Variables

### Required
- **`SPARQL_ENDPOINT`**: SPARQL endpoint URL for RDF data exploration

### Optional
- **`PUBLIC_URL`**: Public URL for the server (default: `http://localhost:3000`)
  - Used for generating citation links
  - Example: `https://your-domain.com`
- **`MCP_PORT`**: HTTP server port (default: `3000`)
- **`ENDPOINT_ENGINE`**: SPARQL engine type - `qlever` or `fallback` (default: `fallback`)
- **`SPARQL_TOKEN`**: Authentication token for SPARQL endpoint (sent as Bearer token)
- **`LOG_FILE`**: Path to log file (logs to stdout if not set)
- **`LOG_LEVEL`**: Logging level - `debug`, `info`, `warn`, `error` (default: `info`)
- **`EMBEDDING_BATCH_SIZE`**: Batch size for embedding processing (default: `32`)
- **`CUSTOM_PREFIXES`**: Custom RDF URI prefixes (format: `prefix:<uri>,prefix2:<uri2>`)
  - Example: `dblp:<https://dblp.org/rdf/schema#>,mydata:<http://example.com/data/>`

## MCP Client Configuration

To connect an MCP client to this server, configure it to use the HTTP transport:

```json
{
  "mcpServers": {
    "kg-mcp": {
      "url": "http://localhost:3000/mcp",
      "transport": "http"
    }
  }
}
```

**Note**: The exact configuration format depends on your MCP client. The server uses the [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports) protocol.

## Citation System

The `cite` tool generates unique, resolvable URLs for RDF triples:

1. **Verify** facts using the `verify` tool
2. **Cite** them using the `cite` tool to get a URL
3. Users can click the citation link to view the raw RDF triples in Turtle format

Citation URLs are session-scoped and use human-readable word IDs.
Wordlist source: https://github.com/david47k/top-english-wordlists (top_english_words_lower_20000.txt).

## Architecture

- **HTTP Server**: Express-based server with MCP Streamable HTTP transport
- **Session Management**: Multiple concurrent client sessions supported
- **SSE Resumability**: Server-Sent Events with automatic reconnection support
- **Citation Database**: In-memory storage per server instance

## Scripts

- **`npm run build`** - Compile TypeScript to JavaScript
- **`npm run start`** - Build and start the HTTP server
- **`npm run test`** - Run tests
- **`npm run init`** - Initialize (one-time setup - downloads embedding model, etc.,) 

## License

MIT
