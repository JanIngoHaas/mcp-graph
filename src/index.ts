import "dotenv/config";
import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { InMemoryEventStore } from "@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";
import { createServer } from "./server.js";
import Logger from "./utils/logger.js";
import { CitationDatabase } from "./utils/CitationDatabase.js";
import { generateCitationHtml } from "./utils/formatting.js";
import type { Quad } from "@rdfjs/types";

async function main() {
    // Get configuration from environment variables
    const sparqlEndpoint: string | undefined = process.env.SPARQL_ENDPOINT;
    const sparqlToken: string | undefined = process.env.SPARQL_TOKEN;
    const logFile: string | undefined = process.env.LOG_FILE;
    const endpointEngine: string = process.env.ENDPOINT_ENGINE || "fallback";
    const port = process.env.MCP_PORT ? parseInt(process.env.MCP_PORT) : 3000;
    const publicUrl: string = process.env.PUBLIC_URL || `http://localhost:${port}`;

    // Create shared citation database
    const citationDb = new CitationDatabase();

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

    // Initialize logger
    Logger.initialize({
        logFile,
        logLevel: process.env.LOG_LEVEL || "info",
        enableConsole: process.env.NODE_ENV === "development",
    });

    Logger.info("Starting MCP Graph server (HTTP Streamable)...", {
        sparqlEndpoint,
        endpointEngine,
        publicUrl,
        port,
    });

    // Create Express app with JSON middleware
    const app = express();
    app.use(express.json());

    // Map to store transports by session ID
    const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

    // Taken from + adapted: https://github.com/modelcontextprotocol/typescript-sdk/tree/main/examples/server
    // MCP POST endpoint - handles JSON-RPC requests
    const mcpPostHandler = async (req: Request, res: Response) => {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        try {
            let transport: StreamableHTTPServerTransport;

            if (sessionId && transports[sessionId]) {
                // Reuse existing transport for this session
                transport = transports[sessionId];
            } else if (!sessionId && isInitializeRequest(req.body)) {
                // New initialization request - create new session
                const eventStore = new InMemoryEventStore();

                transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                    eventStore, // Enable resumability
                    onsessioninitialized: (id) => {
                        Logger.info(`Session initialized: ${id}`);
                        transports[id] = transport;
                    },
                });

                // Clean up transport when session closes
                transport.onclose = () => {
                    const sid = transport.sessionId;
                    if (sid && transports[sid]) {
                        Logger.info(`Transport closed for session ${sid}`);
                        delete transports[sid];
                        // Clean up citations for this session
                        citationDb.cleanupSession(sid);
                    }
                };

                // Create a new MCP server instance for this session
                const server = await createServer(
                    sparqlEndpoint,
                    endpointEngine.toLowerCase(),
                    sparqlToken,
                    publicUrl,
                    citationDb
                );

                // Connect the transport to the server
                await server.connect(transport);

                // Handle the initialize request
                await transport.handleRequest(req, res, req.body);
                return;
            } else {
                // Invalid request - no session ID or not an initialize request
                res.status(400).json({
                    jsonrpc: "2.0",
                    error: {
                        code: -32000,
                        message: "Bad Request: No valid session ID provided",
                    },
                    id: null,
                });
                return;
            }

            // Handle the request with existing transport
            await transport.handleRequest(req, res, req.body);
        } catch (error) {
            Logger.info("Error in POST /mcp", { error });
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: "2.0",
                    error: {
                        code: -32603,
                        message: "Internal server error",
                    },
                    id: null,
                });
            }
        }
    };

    // MCP GET endpoint - handles SSE (Server-Sent Events) streams
    const mcpGetHandler = async (req: Request, res: Response) => {
        const sessionId = (req.headers["mcp-session-id"] as string)

        if (!sessionId || !transports[sessionId]) {
            res.status(400).send("Invalid or missing session ID");
            return;
        }

        // Check for Last-Event-ID header for resumability
        const lastEventId = req.headers["last-event-id"] as string | undefined;
        if (lastEventId) {
            Logger.info(`Client reconnecting with Last-Event-ID: ${lastEventId}`);
        } else {
            Logger.info(`Establishing new SSE stream for session ${sessionId}`);
        }

        const transport = transports[sessionId];
        await transport.handleRequest(req, res);
    };

    // MCP DELETE endpoint - handles session termination
    const mcpDeleteHandler = async (req: Request, res: Response) => {
        const sessionId = (req.headers["mcp-session-id"] as string)

        if (!sessionId || !transports[sessionId]) {
            res.status(400).send("Invalid or missing session ID");
            return;
        }

        Logger.info(`Termination request for session ${sessionId}`);

        try {
            const transport = transports[sessionId];
            await transport.handleRequest(req, res);
        } catch (error) {
            Logger.info("Error handling session termination", { error });
            if (!res.headersSent) {
                res.status(500).send("Error processing session termination");
            }
        }
    };

    // Citation endpoint - returns the citation verification page
    app.get("/citation/:citationId", async (req: Request, res: Response) => {
        const citationId = req.params.citationId as string;
        const citation = citationDb.getCitation(citationId);

        if (!citation) {
            res.status(404).send("Citation not found");
            return;
        }

        try {
            let html: string;
            if (citation.type === 'triple') {
                html = await generateCitationHtml(citation.quads, citationId);
            } else {
                html = await generateCitationHtml(
                    citation.result.quads,
                    citationId,
                    {
                        title: "Query Results",
                        description: citation.description
                    }
                );
            }
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.send(html);
        } catch (e) {
            Logger.error("Error generating citation HTML", { error: e });
            res.status(500).send("Error generating citation page");
        }
    });

    // Register routes
    app.post("/mcp", mcpPostHandler);
    app.get("/mcp", mcpGetHandler);
    app.delete("/mcp", mcpDeleteHandler);

    // Start HTTP server
    const httpServer = app.listen(port, () => {
        Logger.info(`MCP HTTP Server listening on http://localhost:${port}/mcp`);
    });

    // Graceful shutdown
    process.on("SIGINT", async () => {
        Logger.info("Shutting down application...");

        // Close all active transports
        for (const sessionId in transports) {
            try {
                Logger.info(`Closing transport for session ${sessionId}`);
                await transports[sessionId].close();
                delete transports[sessionId];
            } catch (error) {
                Logger.info(`Error closing transport for session ${sessionId}`, { error });
            }
        }

        Logger.info("Closing HTTP server...");
        httpServer.close(() => {
            Logger.info("Server shutdown complete");
            process.exit(0);
        });
    });
}

main().catch((error) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    Logger.info("Server error", { error: errorMessage, stack: errorStack });
    process.exit(1);
});
