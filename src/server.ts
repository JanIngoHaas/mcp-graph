import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { QueryService } from "./services/QueryService.js";
import { SearchService } from "./services/SearchService.js";
import { InspectionService } from "./services/InspectionService.js";
import { EmbeddingHelper } from "./services/EmbeddingHelper.js";
import { DatabaseHelper } from "./services/DatabaseHelper.js";
import Logger from "./utils/logger.js";

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
2a) Use searchAll to find relevant classes and properties - be aware that this is a syntactic, fuzzy search.
2b) In case, searchAll didn't return desired results, use semanticSearch to find relevant classes and properties. Here, you can structure your request more freely and flexibly.
3) Use inspectMetadata to get more details about specific classes or properties, e.g. what properties you can use in a subsequent SPARQL query or what the domain and range of a property is.
4) Use inspectData to explore actual data connections (incoming/outgoing relationships) for specific entities/instances from the knowledge graph.
5) Use makeQuery to execute a SPARQL query against the Knowledge Graph. You can use the results from searchAll, inspectMetadata, and inspectData to construct your query.
`,
    }
  );

  // Initialize services and helpers
  const queryService = new QueryService();
  const embeddingService = new EmbeddingHelper();
  const databaseHelper = new DatabaseHelper(dbPath);
  const searchService = new SearchService(
    queryService,
    embeddingService,
    databaseHelper
  );
  const inspectionService = new InspectionService(queryService);

  // Initialize exploration on startup
  await searchService.exploreOntology(sparqlEndpoint, (processed, total) => {
    Logger.info(
      `Ontology exploration progress: ${processed} items${
        total ? ` of ${total}` : ""
      } processed`
    );
  });

  if (initOnly) {
    Logger.info(
      'Initialization complete with "init only" mode. No tools registered.'
    );
  }

  server.registerTool(
    "makeQuery",
    {
      description:
        "Send a SPARQL query to the Knowledge Graph. Search for useable properties first to know what to query.",
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

  // Register the semantic search tool
  server.registerTool(
    "semanticSearch",
    {
      description:
        'Search for RDF ontological constructs using semantic similarity. Specify whether to search for classes or properties. Returns ontology URIs - use inspectMetadata for full details. Examples: "person birth date" (finds birthDate property), "location coordinates" (finds geographic properties), "organization concept" (finds Organization class)',
      inputSchema: {
        query: z.string().describe("The natural language search query"),
        searchType: z
          .enum(["class", "property"])
          .describe(
            "Whether to search for classes ('class') or properties ('property')"
          ),
        limit: z
          .number()
          .optional()
          .default(10)
          .describe("Maximum number of results to return (default: 10)"),
      },
    },
    async (request: {
      query: string;
      searchType: "class" | "property";
      limit: number;
    }) => {
      const { query, searchType, limit } = request;

      if (!query) {
        throw new Error("Query parameter is required");
      }

      const results = await searchService.searchOntology(
        query,
        searchType,
        limit,
        sparqlEndpoint
      );

      const response = searchService.renderOntologyResult(results);

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

  // Register the search all tool
  server.registerTool(
    "searchAll",
    {
      description:
        'Search for any RDF entities (data such as resources or individuals, as well as metadata (ontological constructs)) using syntactic full-text search. Examples: "Einstein" (finds Albert Einstein), "quantum*" (finds quantum mechanics, quantum physics)',
      inputSchema: {
        query: z
          .string()
          .describe(
            'The search query to find entities. Uses syntactic full-match search with wildcard support (e.g., "Einstein", "quantum*"). NOTE: This is not a semantic search - use precise single-word or sub-word queries for best results (e.g. "Einstein" or "Einst" instead of "Albert Einstein works")'
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

      const results = await searchService.searchAll(
        query,
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

  // Register the inspect metadata tool
  server.registerTool(
    "inspectMetadata",
    {
      description:
        'Inspect any metadata URI (properties, classes, ...) to see all related properties, domains and ranges. Example: "http://dbpedia.org/ontology/birthDate" (inspect birthDate property and returns its domain and range), Example: "http://dbpedia.org/ontology/Person" (inspect Person class and returns its properties)',
      inputSchema: {
        uri: z
          .string()
          .describe(
            "The URI to inspect - can be a property, class, something used as domain/range, or any other metadata URI"
          ),
      },
    },
    async (request: { uri: string }) => {
      const { uri } = request;
      try {
        const result = await inspectionService.inspectMetadata(
          uri,
          sparqlEndpoint
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
        throw new Error(`Failed to inspect resource: ${error}`);
      }
    }
  );

  // Register the inspect data tool
  server.registerTool(
    "inspectData",
    {
      description:
        'Inspect actual data connections for any URI (entity/instance) to see all incoming and outgoing relationships. Shows what properties connect to/from this entity and their values. Example: "http://dbpedia.org/resource/Julius_Caesar" (shows all relationships like birthDate, birthPlace, spouse, etc.)',
      inputSchema: {
        uri: z
          .string()
          .describe(
            "The URI to inspect - should be an entity/instance URI (not a class or property)"
          ),
        expandProperties: z
          .array(z.string())
          .optional()
          .default([])
          .describe(
            "Optional array of property URIs to expand and show all values for (by default only shows first few values)"
          ),
      },
    },
    async (request: { uri: string; expandProperties?: string[] }) => {
      const { uri, expandProperties = [] } = request;
      try {
        const result = await inspectionService.inspectData(
          uri,
          sparqlEndpoint,
          expandProperties
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
        throw new Error(`Failed to inspect data: ${error}`);
      }
    }
  );

  return server;
}
