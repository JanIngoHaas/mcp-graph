import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { QueryService } from "./services/QueryService.js";
import { SearchService } from "./services/SearchService.js";
import { InspectionService } from "./services/InspectionService.js";
import { EmbeddingHelper } from "./services/EmbeddingHelper.js";
import { QueryParserService, FallbackBackend, QLeverBackend } from "./utils/queryParser.js";

export async function createServer(
  sparqlEndpoint: string,
  initOnly: boolean = false,
  dbPath?: string
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
3) Use inspect to get detailed information about any URI found in step 2. This automatically detects whether it's a class/property (shows domain/range) or an entity (shows data connections).
4) Use query to execute a SPARQL query against the Knowledge Graph. You can use the results from searchAll and inspect to construct your query.
`,
    }
  );

  // Initialize services and helpers
  const queryService = new QueryService();
  const embeddingService = new EmbeddingHelper();
  const searchService = new SearchService(queryService, "fallback");
  const inspectionService = new InspectionService(queryService, sparqlEndpoint, embeddingService);

  if (initOnly) {
    return server;
  }

  server.registerTool(
    "query",
    {
      description:
        "Execute a SPARQL query against the Knowledge Graph. Search for useable properties first to know what to query.",
      inputSchema: {
        query: z
          .string()
          .describe(
            "The SPARQL query to execute - must be a valid SPARQL query. Define any PREFIXes yourself if needed."
          ),
      },
    },
    async (request: { query: string }) => {
      const { query } = request;
      const res = await queryService.executeQuery(query, [sparqlEndpoint]);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(res, null, 2),
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
        `Search for RDF entities using boolean queries. Examples:
- 'Einstein' finds the word Einstein
- 'Anton Hinkel' finds both words anywhere (AND logic)  
- '"Anton Hinkel"' finds exact phrase
- 'Thomas OR Albert' finds either name
- 'physicist AND Nobel' finds both terms
- '(quantum mechanics) AND Einstein' uses grouping
Quoted strings are exact phrases, unquoted multi-words require all words to appear.`,
      inputSchema: {
        query: z
          .string()
          .describe(
            'Boolean search query. Examples: "Einstein" (exact phrase), Einstein (single term), Thomas OR Albert (union), physicist AND Nobel (intersection), (quantum mechanics) AND Einstein (grouping), Thomas Hinkel (both words must appear). Quoted strings are exact phrases, unquoted multi-words require all words to appear.'
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
          .optional()
          .describe(
            "Optional query to filter and rank results by semantic relevance. Results will be ordered by similarity to this query."
          ),
        maxResults: z
          .number()
          .optional()
          .describe(
            "Maximum number of results to return per category. Only applies when relevantToQuery is set or when you want to limit output."
          ),
      },
    },
    async (request: {
      uri: string;
      expandProperties?: string[];
      relevantToQuery?: string;
      maxResults?: number;
    }) => {
      const { uri, expandProperties = [], relevantToQuery, maxResults } = request;
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
