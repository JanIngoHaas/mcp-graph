#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import path from "path";
import os from "os";

async function main() {
  console.error(`Starting MCP Graph server...`);

  const args = process.argv.slice(2);

  // Default to memory, allow override via environment or args
  let dbPath: string | undefined = process.env.MCP_GRAPH_DB_PATH;
  let sparqlEndpoint: string | undefined = process.env.SPARQL_ENDPOINT;

  // Parse arguments in format: [dbPath] [sparqlEndpoint]
  // If only one argument is provided and it starts with http, treat it as SPARQL endpoint
  if (args.length === 1) {
    if (args[0].startsWith("http")) {
      sparqlEndpoint = args[0];
    } else {
      dbPath = args[0];
    }
  } else if (args.length >= 2) {
    dbPath = args[0];
    sparqlEndpoint = args[1];
  }

  const server = await createServer(dbPath, sparqlEndpoint);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Server started successfully.`);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
