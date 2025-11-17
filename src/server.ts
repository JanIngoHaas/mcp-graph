import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { QueryService } from "./services/QueryService.js";
import { SearchService } from "./services/SearchService.js";
import { InspectionService } from "./services/InspectionService.js";
import { EmbeddingHelper } from "./services/EmbeddingHelper.js";
import { QueryParserService, FallbackBackend, QLeverBackend } from "./utils/queryParser.js";

export async function createServer(
  sparqlEndpoint: string,
  endpointEngine: string = "fallback"
): Promise<McpServer> {
  const server = new McpServer(
    {
      name: "rdfGraphExplorer",
      version: "0.1.0",
    },
    {
      instructions: `This is a service to connect you to an RDF-based Knowledge Graph. You can use it to query and explore the graph.
Process (you may deviate if deemed necessary - be flexible!):
1) Identify key terms in the user's query.
2) Use search to find relevant classes, properties, and entities.
3) Use inspect to get detailed information about any URI found in step 2. This automatically detects whether it's a class/property (shows domain/range) or an entity (shows data connections). IMPORTANT: You MUST provide a relevantToQuery parameter - use the user's original search query or a related semantic query. Results are limited to 15 by default - increase maxResults (e.g., to 1000) if you need to see more.
4) Use query to execute a SPARQL query against the Knowledge Graph. You can use the results from search and inspect to construct your query.
`,
    }
  );

  // Initialize services and helpers
  const queryService = new QueryService();
  const embeddingService = new EmbeddingHelper();
  const searchService = new SearchService(queryService, endpointEngine);
  const inspectionService = new InspectionService(queryService, sparqlEndpoint, embeddingService);

  server.registerTool(
    "query",
    {
      description:
        "Execute a SPARQL query against the Knowledge Graph with language filtering and row limiting. Search for useable properties first to know what to query.",
      inputSchema: {
        query: z
          .string()
          .describe(
            "The SPARQL query to execute - must be a valid SPARQL query. Define any PREFIXes yourself if needed."
          ),
        language: z
          .string()
          .optional()
          .default("all")
          .describe(
            "Language code for filtering results. Use ISO 639-1 two-letter codes like 'en' for English, 'de' for German, 'fr' for French, 'es' for Spanish, etc. Results will include entries with this language tag or language-neutral content. Default: 'all' languages - should be fine in many cases."
          ),
        maxRows: z
          .number()
          .optional()
          .default(100)
          .describe(
            "Maximum number of rows to return (default: 100)."
          ),
      },
    },
    async (request: { query: string; language: string; maxRows?: number }) => {
      const { query, language, maxRows = 100 } = request;
      const res = await queryService.executeQuery(query, [sparqlEndpoint], language, maxRows);

      return {
        content: [
          {
            type: "text",
            text: res,
          },
        ],
      };
    }
  );


  // Register the search all tool
  server.registerTool(
    "search",
    {
      description:
        `Search for RDF entities using boolean queries.`,
      inputSchema: {
        query: z
          .string()
          .describe(
            `Boolean search query using syntactic, fuzzy search algorithm (be more precise). Examples: '"Albert Einstein"' (exact phrase), 'Albert Einstein' (sentences containing both 'Albert' and 'Einstein'. PREFER THIS - you will have better results and you can later fine-tune your search), 'Thomas OR Albert' (union), 'physicist AND Nobel' (intersection), '(quantum mechanics) AND Einstein' (grouping), 'Thomas Hinkel' (both words must appear). Quoted strings are exact phrases, unquoted multi-words require all words to appear. PREFER UNQUOTED for better results.`
          ),
        limit: z
          .number()
          .optional()
          .default(20)
          .describe("Maximum number of results to return (default: 20)"),
        offset: z
          .number()
          .optional()
          .default(0)
          .describe("Number of results to skip for pagination (default: 0)"),
      },
    },
    async (request: { query: string; limit: number; offset: number }) => {
      const { query, limit, offset } = request;

      if (!query) {
        throw new Error("Query parameter is required");
      }

      // Trim any leading/trailing single quotes from query
      const trimmedQuery = query.replace(/^'|'$/g, '');

      const results = await searchService.searchAll(
        trimmedQuery,
        sparqlEndpoint,
        limit,
        offset
      );

      const response = searchService.renderResourceResult(results);

      return {
        content: [
          {
            type: "text",
            text: response,
          },
        ],
      };
    }
  );

  // Register the unified inspect tool
  server.registerTool(
    "inspect",
    {
      description:
        'Inspect any URI in the knowledge graph. Shows relationships and properties for classes, properties, or entities.',
      inputSchema: {
        uri: z
          .string()
          .describe(
            "The URI to inspect - can be a class, property, entity, or any other URI in the knowledge graph"
          ),
        expandProperties: z
          .array(z.string())
          .optional()
          .default([])
          .describe(
            "Optional array of property URIs to expand and show all values for (only applies to entity inspection, by default only shows first few values)"
          ),
        relevantToQuery: z
          .string()
          .describe(
            "Query to filter and rank results by semantic relevance. Results will be ordered by similarity to this query."
          ),
        maxResults: z
          .number()
          .optional()
          .default(15)
          .describe(
            "Maximum number of results to return per category (default: 15). Set to a high number like 1000 if you need to see all results."
          ),
      },
    },
    async (request: {
      uri: string;
      expandProperties?: string[];
      relevantToQuery: string;
      maxResults?: number;
    }) => {
      const { uri, expandProperties = [], relevantToQuery, maxResults = 15 } = request;
      try {
        const result = await inspectionService.inspect(
          uri,
          expandProperties,
          relevantToQuery,
          maxResults
        );

        return {
          content: [
            {
              type: "text",
              text: result,
            },
          ],
        };
      } catch (error) {
        throw new Error(`Failed to inspect URI: ${error}`);
      }
    }
  );

  return server;
}
