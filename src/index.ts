#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import Logger from "./utils/logger.js";
import path from "path";
import os from "os";

async function main() {
  // Get configuration from environment variables only
  const dbPath: string = process.env.DB_PATH || ":cache:";
  const sparqlEndpoint: string | undefined = process.env.SPARQL_ENDPOINT;
  const logFile: string | undefined = process.env.LOG_FILE;

  // Validate sparqlEndpoint is provided
  if (!sparqlEndpoint) {
    throw new Error(
      "SPARQL endpoint is not defined - set SPARQL_ENDPOINT environment variable."
    );
  }

  // Initialize logger - logs to stderr if LOG_FILE not set, to file if set
  Logger.initialize({
    logFile,
    logLevel: process.env.LOG_LEVEL || "info",
    enableConsole: process.env.NODE_ENV === "development",
  });

  Logger.info("Starting MCP Graph server...", { dbPath, sparqlEndpoint });

  // Check for init mode from argv or environment variable
  const initOnly =
    process.argv.includes("--init") || process.env.INIT === "true";

  const server = await createServer(sparqlEndpoint, initOnly, dbPath);
  
  if (initOnly) {
    Logger.info("Initialization complete. Exiting.");
    process.exit(0);
  }
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  Logger.info("Server started successfully.");
}

main().catch((error) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;
  Logger.error("Server error", { error: errorMessage, stack: errorStack });
  process.exit(1);
});
