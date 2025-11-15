#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import Logger from "./utils/logger.js";
import path from "path";
import os from "os";

async function main() {
  // Get configuration from environment variables only
  const sparqlEndpoint: string | undefined = process.env.SPARQL_ENDPOINT;
  const logFile: string | undefined = process.env.LOG_FILE;
  const endpointEngine: string = process.env.ENDPOINT_ENGINE || "fallback";

  // Validate sparqlEndpoint is provided
  if (!sparqlEndpoint) {
    throw new Error(
      "SPARQL endpoint is not defined - set SPARQL_ENDPOINT environment variable."
    );
  }

  // Validate endpointEngine is valid
  if (!["qlever", "fallback"].includes(endpointEngine.toLowerCase())) {
    throw new Error(
      "Invalid ENDPOINT_ENGINE value. Must be 'qlever' or 'fallback'."
    );
  }

  // Initialize logger - logs to stderr if LOG_FILE not set, to file if set
  Logger.initialize({
    logFile,
    logLevel: process.env.LOG_LEVEL || "info",
    enableConsole: process.env.NODE_ENV === "development",
  });

  Logger.info("Starting MCP Graph server...", { sparqlEndpoint, endpointEngine });

  const server = await createServer(sparqlEndpoint, endpointEngine.toLowerCase());
  
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  Logger.info("Server started successfully.");
}

main().catch((error) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;
  Logger.info("Server error", { error: errorMessage, stack: errorStack });
  process.exit(1);
});
