import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { QueryService } from "./services/QueryService.js";
import { SearchService } from "./services/SearchService.js";
import { InspectionService } from "./services/InspectionService.js";
import { TripleService } from "./services/TripleService.js";
import { QueryBuilderService } from "./services/QueryBuilderService.js";
import { formatQuadsToMarkdown, formatQuadsToTtl } from "./utils/formatting.js";
import { EmbeddingHelper } from "./services/EmbeddingHelper.js";
import { CitationDatabase } from "./utils/CitationDatabase.js";

function checkSession(extra: any): string {
  const sessionId = extra?.sessionId;
  if (!sessionId) {
    throw new Error("No session ID available. This tool requires a connected session.");
  }
  return sessionId;
}

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
4) [CITABLE] Use 'fact' to check facts (simple pattern matching). This tool can be CITED.
5) [CITABLE] Use 'query_builder' to build explainable queries more easily. This ensures your queries are safe and syntax-error-free. This tool can be CITED.
6) Use 'cite' to activate a citation for a fact or query you have verified.

CITATION RULE: When you verify a claim using 'fact' or 'query_builder', the output will contain a "Citation Key". To make this citation user-facing, you MUST call the 'cite_tool' with this key.`,
    }
  );

  // Initialize services and helpers
  const queryService = new QueryService(sparqlToken);
  const embeddingService = new EmbeddingHelper();
  const searchService = new SearchService(queryService, endpointEngine);
  const inspectionService = new InspectionService(queryService, sparqlEndpoint, embeddingService);
  const tripleService = new TripleService(queryService, sparqlEndpoint);
  const queryBuilderService = new QueryBuilderService(queryService, sparqlEndpoint, searchService.getQueryParser());

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

  // Shared schemas for tools
  const FactInputSchema = {
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
      .default(100)
      .describe("Maximum number of triples to return (default: 100)"),
  };

  const QueryBuilderInputSchema = {
    type: z
      .string()
      .describe("The RDF class URI to query (e.g., 'https://dblp.org/rdf/schema#Publication')"),
    filters: z
      .array(
        z.object({
          path: z
            .string()
            .describe("Property path, dot-separated for traversal (e.g., 'authoredBy.label'). Full URIs MUST be wrapped in <...>. Prefixed names and plain 'label' (shorthand for rdfs:label) are supported."),
          operator: z
            .enum(["=", "!=", ">", "<", ">=", "<=", "contains", "search"])
            .describe("Comparison operator"),
          value: z
            .string()
            .describe("The comparison value"),
        })
      )
      .optional()
      .describe("Filter conditions applied with AND logic"),
    project: z
      .array(z.string())
      .describe("Property paths to return as columns (e.g., ['label', 'dblp:yearOfPublication']). Full URIs MUST be wrapped in <...>."),
    limit: z
      .number()
      .default(100)
      .describe("Maximum number of results to return (default: 100). Higher limits may cause performance issues or timeouts."),
  };

  type FactRequest = {
    subject: string;
    predicate: string;
    object: string;
    limit: number;
  }

  // Register the verify tool for simple pattern matching
  server.registerTool(
    "fact",
    {
      description:
        "[CITABLE] Verify specific relationships or find missing values. Returns a citation key that can be used with the 'cite' tool (to prove your claims). Use wildcard '_' to discover unknown parts of a triple. Use this tool for simple factoid questions or to verify a single or multiple simple claims precisely. Do not use this tool for complex queries that require complex multiple steps or joins.",
      inputSchema: FactInputSchema,
    },
    async (request: FactRequest, extra: any) => {
      const { subject, predicate, object, limit } = request;
      const sessionId = checkSession(extra);


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
      const md = formatQuadsToMarkdown(result, true);

      // Generate citation
      const citationId = citationDb.storeCitation(sessionId, result);
      const citationMsg = `\n\nCitation Key: ${citationId}. Call 'cite' with this key to generate a verification link that the user can view.`;

      return {
        content: [
          {
            type: "text",
            text: md + citationMsg,
          },
        ],
      };
    }
  );

  // Register the generic cite tool
  server.registerTool(
    "cite",
    {
      description:
        "Activate a citation. Pass the 'key' (UUID) you received from 'fact' or 'query_builder' to generate a permanent user-facing link that the user can open in their browser and view to verify your claims!",
      inputSchema: {
        key: z.string().describe("The citation key (UUID) to activate")
      },
    },
    async (request: { key: string }) => {
      const { key } = request;
      const success = citationDb.activateCitation(key);

      if (success) {
        // reconstruct the link to show it to the agent
        const citationLink = `${citationBase}/${key}`;
        return {
          content: [
            {
              type: "text",
              text: `Citation activated: [Source](${citationLink})\nYou may now include this link in your (final) response to the USER.`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: "text",
              text: `Error: Citation key '${key}' not found or invalid.`,
            },
          ],
        };
      }
    }
  );

  type QueryBuilderRequest = {
    type: string
    filters?: Array<{ path: string; operator: "=" | "!=" | ">" | "<" | ">=" | "<=" | "contains" | "search"; value: string }>;
    project: string[];
    limit: number;
  }

  // Register the query_builder tool for structured queries with path traversal
  server.registerTool(
    "query_builder",
    {
      description:
        `[CITABLE] Build and execute structured queries with relationship traversal. Returns a citation key that can be used with the 'cite' tool (to prove your claims). Use this tool to filter lists of entities.\n\nKey Features:\n- Path Traversal: Filter by properties of related entities using dot notation (e.g., 'dblp:authoredBy.label' checks the label of the author).\n- Multiple Filters: Combine multiple conditions.\n- JSON Escaping: String values with double quotes use standard JSON escaping (\"value\").\n\nExample: "Find publications by 'Martin Gaedke' published after 2020"\n{\n  "type": "https://dblp.org/rdf/schema#Publication",\n  "filters": [\n    { "path": "dblp:authoredBy.label", "operator": "contains", "value": "Martin Gaedke" },\n    { "path": "dblp:yearOfPublication", "operator": ">", "value": "\"2020\"^^xsd:gYear" }\n  ],\n  "project": ["label", "dblp:yearOfPublication", "dblp:authoredBy.label"]\n}`,
      inputSchema: QueryBuilderInputSchema,
    },
    async (request: QueryBuilderRequest, extra: any) => {
      const { type, filters, project, limit } = request;
      const sessionId = checkSession(extra);

      try {
        // Transform filters to proper type
        const typedFilters = filters?.map(f => ({
          path: f.path,
          operator: f.operator,
          value: f.value,
        }));

        const result = await queryBuilderService.executeQuery({
          type,
          filters: typedFilters,
          project,
          limit,
        });

        // Format result as markdown table
        const markdown = formatQuadsToMarkdown(result.quads, true);

        // Generate description
        const description = await queryBuilderService.generateDescription({
          type,
          filters: typedFilters,
          project,
          limit,
        });

        const citationId = citationDb.storeQueryBuilderCitation(
          sessionId,
          result,
          description
        );
        const citationMsg = `\n\nCitation Key: ${citationId}. Call 'cite' with this key to generate a verification link that the user can view.`;

        return {
          content: [
            {
              type: "text",
              text: markdown + citationMsg,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error executing query: ${error}`,
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
      const sessionId = checkSession(extra);

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
