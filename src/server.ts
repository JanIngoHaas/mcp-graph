import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { QueryService } from "./services/QueryService.js";
import { SearchService } from "./services/SearchService.js";
import { InspectionService } from "./services/InspectionService.js";
import { TripleService } from "./services/TripleService.js";
import { CollectionService } from "./services/CollectionService.js";
import { formatQuadsToMarkdown, formatQuadsToTtl } from "./utils/formatting.js";
import { EmbeddingHelper } from "./services/EmbeddingHelper.js";
import { CitationDatabase } from "./utils/CitationDatabase.js";

export async function createServer(
  sparqlEndpoint: string,
  endpointEngine: string,
  sparqlToken: string | undefined,
  publicUrl: string,
  citationDb: CitationDatabase
): Promise<McpServer> {
  const baseUrl = publicUrl.replace(/\/$/, ""); // Just the trail!
  const citationBase = `${baseUrl}/citation`;

  const server = new McpServer(
    {
      name: "rdfGraphExplorer",
      version: "0.1.0",
    },
    {
      instructions: `This service connects you to an RDF-based Knowledge Graph for exploration and querying.

Usage Information:
1) Use 'search' to find relevant entities, classes, and properties for your topic
2) Use 'inspect' on interesting URIs to understand their relationships and properties
3) Use 'query' to execute precise SPARQL queries based on your discoveries
4) Use 'fact' to check facts (simple pattern matching)
5) Use 'cite_fact' to generate a verification link for the USER. This link reveals the same triples you verified with 'fact'.
6) Use 'collection' to query filtered/mapped result sets from RDF collections
7) Use 'cite_collection' to generate a citation link for collection queries
CITATION RULE: Always check facts first with 'fact', then cite them using 'cite_fact' when making a claim.
`,
    }
  );

  // Initialize services and helpers
  const queryService = new QueryService(sparqlToken);
  const embeddingService = new EmbeddingHelper();
  const searchService = new SearchService(queryService, endpointEngine);
  const inspectionService = new InspectionService(queryService, sparqlEndpoint, embeddingService);
  const tripleService = new TripleService(queryService, sparqlEndpoint);
  const collectionService = new CollectionService(queryService, sparqlEndpoint, searchService.getQueryParser());

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

  // Register the verify tool for simple pattern matching
  server.registerTool(
    "fact",
    {
      description:
        "Verify RDF triples via pattern matching. Use '_' as wildcard to discover relationships (up to 2 wildcards allowed).",
      inputSchema: {
        subject: z
          .string()
          .describe("The subject URI or '_' as wildcard"),
        predicate: z
          .string()
          .describe("The predicate URI or '_' as wildcard"),
        object: z
          .string()
          .describe("The object URI or '_' as wildcard"),
        limit: z
          .number()
          .optional()
          .default(50)
          .describe("Maximum number of triples to return (default: 50)"),
      },
    },
    async (request: { subject: string; predicate: string; object: string; limit?: number }) => {
      const { subject, predicate, object, limit = 50 } = request;
      const result = await tripleService.completeTriple(subject, predicate, object, limit);

      if (result.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No matching triples found.",
            },
          ],
        };
      }

      // Format as Markdown for the model
      const md = formatQuadsToMarkdown(result);

      return {
        content: [
          {
            type: "text",
            text: md,
          },
        ],
      };
    }
  );

  // Register the cite tool for citation generation
  server.registerTool(
    "cite_fact",
    {
      description:
        "Generate a citation link for the user. This tool creates a link that allows the user to view the same RDF triples you verified. It validates the pattern but does NOT return the triple details again.",
      inputSchema: {
        subject: z
          .string()
          .describe("The subject URI or '_' as wildcard"),
        predicate: z
          .string()
          .describe("The predicate URI or '_' as wildcard"),
        object: z
          .string()
          .describe("The object URI or '_' as wildcard"),
        limit: z
          .number()
          .optional()
          .default(50)
          .describe("Maximum number of triples to return (default: 50)"),
      },
    },
    async (request: { subject: string; predicate: string; object: string; limit?: number }, extra: any) => {
      const { subject, predicate, object, limit = 50 } = request;

      const result = await tripleService.completeTriple(subject, predicate, object, limit);

      if (result.length === 0) {
        return {
          content: [{ type: "text", text: "No matching triples found. Cannot generate citation." }]
        };
      }

      const sessionId = extra?.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: "text", text: "Error: No session ID available for citation." }]
        };
      }

      const citationId = citationDb.storeCitation(sessionId, result);
      const citationLink = `${citationBase}/${citationId}`;

      return {
        content: [
          {
            type: "text",
            text: `Citation link generated: [Source](${citationLink})\nThis link contains the triples matching the pattern. Use this to assert a claim. Do not try to read this link. It is for the USER only.`,
          },
        ],
      };
    }
  );

  // Register the collection tool for Filter+Map queries
  server.registerTool(
    "collection",
    {
      description:
        "Execute a Filter+Map query over RDF collections. Returns a result table for the agent to analyze.",
      inputSchema: {
        type: z
          .string()
          .describe("The RDF class to query (e.g., http://example.org/ChemicalSubstance)"),
        filter: z
          .object({
            predicate: z.string().describe("The property URI to filter on"),
            operator: z.string().describe("Comparison operator: '>', '<', '>=', '<=', '=', '!=', or 'search' (the 'search' operator uses the same fuzzy logic as the 'search' tool.)"),
            value: z.string().describe("The threshold or comparison value"),
          })
          .optional()
          .describe("Optional filter condition"),
        map: z
          .array(z.string())
          .describe("Array of property URIs to return as columns in the result table"),
        limit: z
          .number()
          .optional()
          .default(1000)
          .describe("Maximum number of results to return (default: 1000)"),
      },
    },
    async (request: {
      type: string;
      filter?: { predicate: string; operator: string; value: string };
      map: string[];
      limit?: number;
    }) => {
      const { type, filter, map, limit = 1000 } = request;

      try {
        const result = await collectionService.executeCollection({
          type,
          filter,
          map,
          limit,
        });

        // Format result as markdown table for the agent
        const markdown = formatQuadsToMarkdown(result.quads);

        return {
          content: [
            {
              type: "text",
              text: markdown,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error executing collection query: ${error}`,
            },
          ],
        };
      }
    }
  );

  // Register the cite_collection tool for citation generation
  server.registerTool(
    "cite_collection",
    {
      description:
        "Generate a citation link for the user. This tool creates a link that allows the user to view the same collection query results. It executes the query but does NOT return the result details again.",
      inputSchema: {
        type: z
          .string()
          .describe("The RDF class to query (e.g., http://example.org/ChemicalSubstance)"),
        filter: z
          .object({
            predicate: z.string().describe("The property URI to filter on"),
            operator: z.string().describe("Comparison operator: '>', '<', '>=', '<=', '=', '!=', or 'search' (the 'search' operator uses the same fuzzy logic as the 'search' tool)"),
            value: z.string().describe("The threshold or comparison value"),
          })
          .optional()
          .describe("Optional filter condition"),
        map: z
          .array(z.string())
          .describe("Array of property URIs to return as columns in the result table"),
        limit: z
          .number()
          .optional()
          .default(1000)
          .describe("Maximum number of results to return (default: 1000)"),
      },
    },
    async (
      request: {
        type: string;
        filter?: { predicate: string; operator: string; value: string };
        map: string[];
        limit?: number;
      },
      extra: any
    ) => {
      const { type, filter, map, limit = 1000 } = request;

      const sessionId = extra?.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: "text", text: "Error: No session ID available for citation." }],
        };
      }

      try {
        // Execute the collection query
        const result = await collectionService.executeCollection({
          type,
          filter,
          map,
          limit,
        });

        if (result.count === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No results found for the collection query. Cannot generate citation.",
              },
            ],
          };
        }

        // Generate description
        const description = await collectionService.generateDescription({
          type,
          filter,
          map,
          limit,
        });

        // Store citation
        const citationId = citationDb.storeCollectionCitation(sessionId, result, description);
        const citationLink = `${citationBase}/${citationId}`;

        return {
          content: [
            {
              type: "text",
              text: `Citation link generated: [Source](${citationLink})\nThis link contains the collection query results. Use this to assert claims about the data. Do not try to read this link. It is for the USER only.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error generating collection citation: ${error}`,
            },
          ],
        };
      }
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

  server.registerResource(
    "citation",
    "citation://session",
    {
      mimeType: "application/json",
      title: "Session Citations",
      description: "Get all citations for the current session as a JSON list, including their raw TTL.",
    },
    async (uri, extra: any) => {
      const sessionId = extra?.sessionId;
      if (!sessionId) {
        throw new Error("No session ID available for citation lookup.");
      }

      const citations = citationDb.getCitationsForSession(sessionId);

      // For the session list, we return a JSON array of citation objects
      // including formatted TTL for triple citations or result data for collections
      const responseData = await Promise.all(citations.map(async (c) => {
        if (c.type === 'triple') {
          return {
            type: 'triple',
            id: c.id,
            sessionId: c.sessionId,
            ttl: await formatQuadsToTtl(c.quads),
            createdAt: c.createdAt
          };
        } else {
          return {
            type: 'collection',
            id: c.id,
            sessionId: c.sessionId,
            description: c.description,
            count: c.result.count,
            ttl: await formatQuadsToTtl(c.result.quads),
            createdAt: c.createdAt
          };
        }
      }));

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(responseData, null, 2),
          },
        ],
      };
    }
  );

  return server;
}
