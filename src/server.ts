import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { QueryService } from "./services/QueryService.js";
import { SearchService } from "./services/SearchService.js";
import { InspectionService } from "./services/InspectionService.js";
import { TripleService } from "./services/TripleService.js";
import { QueryBuilderService } from "./services/QueryBuilderService.js";
import { ExplanationService } from "./services/ExplanationService.js";
import { formatQuadsToMarkdown, formatQuadsToTtl } from "./utils/formatting.js";
import { EmbeddingHelper } from "./services/EmbeddingHelper.js";
import { CitationDatabase } from "./utils/CitationDatabase.js";
import { ExplanationDatabase } from "./utils/ExplanationDatabase.js";

export async function createServer(
  sparqlEndpoint: string,
  endpointEngine: string,
  sparqlToken: string | undefined,
  publicUrl: string,
  citationDb: CitationDatabase,
  explanationDb: ExplanationDatabase
): Promise<McpServer> {
  const baseUrl = publicUrl.replace(/\/$/, ""); // Just the trail!
  const citationBase = `${baseUrl}/citation`;
  const explainBase = `${baseUrl}/explain`;

  const server = new McpServer(
    {
      name: "rdfGraphExplorer",
      version: "0.1.0",
    },
    {
      instructions: `This service connects you to an RDF-based Knowledge Graph for exploration and querying.

WORKFLOW FOR COMPLEX QUESTIONS:
1) Use 'search' to find relevant entities, classes, and properties
2) Use 'inspect' to understand URIs and their relationships  
3) Use 'fact' or 'query_builder' to verify claims
4) Use 'cite_fact' or 'cite_query_builder' to get citation HTML anchors (e.g., <a href="...">[Source]</a>)
5) Use 'explain' as your FINAL output with:
   - title: A descriptive title
   - answer: Your complete response with embedded citation links (the <a> tags from step 4)
   - steps: The verification steps so users can re-execute and verify

The 'explain' tool creates an interactive page where users see your answer with clickable citations, plus they can re-run each step to verify your reasoning.

CITATION FORMAT: cite_xxx tools return HTML anchor tags like <a href="...">[Source]</a>. Embed these directly in your answer text.
`,
    }
  );

  // Initialize services and helpers
  const queryService = new QueryService(sparqlToken);
  const embeddingService = new EmbeddingHelper();
  const searchService = new SearchService(queryService, endpointEngine);
  const inspectionService = new InspectionService(queryService, sparqlEndpoint, embeddingService);
  const tripleService = new TripleService(queryService, sparqlEndpoint);
  const queryBuilderService = new QueryBuilderService(queryService, sparqlEndpoint, searchService.getQueryParser());

  // Create ExplanationService - it registers itself with the database
  const explanationService = new ExplanationService(
    explanationDb,
    searchService,
    inspectionService,
    tripleService,
    queryBuilderService,
    sparqlEndpoint
  );

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
      .describe("Property paths to return as columns (e.g., ['label', 'dblp:year']). Full URIs MUST be wrapped in <...>."),
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
        "Verify specific relationships or find missing values. Use wildcard '_' to discover unknown parts of a triple. Use this tool for simple factoid questions or to verify a single or multiple simple claims precisely. Do not use this tool for complex queries that require complex multiple steps or joins.",
      inputSchema: FactInputSchema,
    },
    async (request: FactRequest) => {
      const { subject, predicate, object, limit } = request;
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
        "Generate a citation link for a verified fact. Use this AFTER verifying with 'fact'. Returns an HTML anchor tag you can embed directly in your answer.",
      inputSchema: FactInputSchema,
    },
    async (request: FactRequest, extra: any) => {
      const { subject, predicate, object, limit } = request;

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
            text: `Citation ID: ${citationId}\nEmbed this in your answer: <a href="${citationLink}" target="_blank">[Source]</a>\n\nUse this HTML anchor tag in your answer text to cite this fact.`,
          },
        ],
      };
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
        `Build and execute structured queries with relationship traversal. Use this tool to filter lists of entities.\n\nKey Features:\n- Path Traversal: Filter by properties of related entities using dot notation (e.g., 'authoredBy.label' checks the label of the author).\n- Multiple Filters: Combine multiple conditions.\n- JSON Escaping: String values with double quotes use standard JSON escaping (\"value\").\n\nExample: "Find publications by 'Martin Gaedke' published after 2020"\n{\n  "type": "https://dblp.org/rdf/schema#Publication",\n  "filters": [\n    { "path": "authoredBy.label", "operator": "contains", "value": "Martin Gaedke" },\n    { "path": "year", "operator": ">", "value": "\"2020\"^^xsd:gYear" }\n  ],\n  "project": ["label", "year", "authoredBy.label"]\n}`,
      inputSchema: QueryBuilderInputSchema,
    },
    async (request: QueryBuilderRequest) => {
      const { type, filters, project, limit } = request;

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
              text: `Error executing query: ${error}`,
            },
          ],
        };
      }
    }
  );

  // Register the cite_query_builder tool for citation generation
  server.registerTool(
    "cite_query_builder",
    {
      description:
        "Generate a citation link for a query_builder query. Use this AFTER executing with 'query_builder'. Returns an HTML anchor tag you can embed directly in your answer.",
      inputSchema: QueryBuilderInputSchema,
    },
    async (
      request: QueryBuilderRequest,
      extra: any
    ) => {
      const { type, filters, project, limit } = request;

      const sessionId = extra?.sessionId;
      if (!sessionId) {
        return {
          content: [{ type: "text", text: "Error: No session ID available for citation." }],
        };
      }

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

        if (result.count === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No results found for the query. Cannot generate citation.",
              },
            ],
          };
        }

        // Generate description
        const description = await queryBuilderService.generateDescription({
          type,
          filters: typedFilters,
          project,
          limit,
        });

        // Store citation
        const citationId = citationDb.storeQueryBuilderCitation(
          sessionId,
          result,
          description
        );
        const citationLink = `${citationBase}/${citationId}`;

        return {
          content: [
            {
              type: "text",
              text: `Citation ID: ${citationId}\nEmbed this in your answer: <a href="${citationLink}" target="_blank">[Source]</a>\n\nUse this HTML anchor tag in your answer text to cite this query result.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error generating query citation: ${error}`,
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

  // Register the explain tool for creating reproducible explanations
  server.registerTool(
    "explain",
    {
      description:
        "Create an interactive explanation page with your answer and the steps you took. This is your FINAL output for complex questions. The 'answer' field contains your response with embedded citation links (from cite_xxx tools). The 'steps' field shows how you arrived at the answer, so users can verify it.",
      inputSchema: {
        title: z
          .string()
          .describe("A descriptive title for this explanation (e.g., 'Finding papers by Martin Gaedke')"),
        answer: z
          .string()
          .describe("Your complete answer to the user's question, with embedded citation links using <a href='...'>[Source]</a> tags from cite_fact or cite_query_builder"),
        steps: z
          .array(
            z.object({
              description: z
                .string()
                .describe("Human-readable description of what this step does (e.g., 'Search for the author')"),
              toolName: z
                .enum(["search", "inspect", "fact", "query_builder"])
                .describe("The tool that was used for this step"),
              toolParams: z
                .record(z.any())
                .describe("The parameters to re-execute this step (same as you used originally)"),
            })
          )
          .describe("The ordered list of verification steps that led to your answer"),
      },
    },
    async (
      request: {
        title: string;
        answer: string;
        steps: Array<{
          description: string;
          toolName: "search" | "inspect" | "fact" | "query_builder";
          toolParams: Record<string, any>;
        }>;
      },
      extra: any
    ) => {
      const { title, answer, steps } = request;
      const sessionId = extra?.sessionId;

      if (!sessionId) {
        return {
          content: [{ type: "text", text: "Error: No session ID available for explanation." }],
        };
      }

      if (!answer) {
        return {
          content: [{ type: "text", text: "Error: An answer is required." }],
        };
      }

      if (!steps || steps.length === 0) {
        return {
          content: [{ type: "text", text: "Error: At least one step is required." }],
        };
      }

      const explanationId = explanationService.storeExplanation(sessionId, title, answer, steps);
      const explanationLink = `${explainBase}/${explanationId}`;

      return {
        content: [
          {
            type: "text",
            text: `Explanation created: [View Interactive Explanation](${explanationLink})\n\nThis page shows your answer with citations and the ${steps.length} verification steps.`,
          },
        ],
      };
    }
  );

  // Register MCP resource for explanations
  server.registerResource(
    "explanation",
    "explanation://session",
    {
      mimeType: "application/json",
      title: "Session Explanations",
      description: "Get all explanations for the current session as a JSON list.",
    },
    async (uri, extra: any) => {
      const sessionId = extra?.sessionId;
      if (!sessionId) {
        throw new Error("No session ID available for explanation lookup.");
      }

      const explanations = explanationDb.getExplanationsForSession(sessionId);

      const responseData = explanations.map((e: any) => ({
        id: e.id,
        sessionId: e.sessionId,
        title: e.title,
        answer: e.answer,
        stepCount: e.steps.length,
        steps: e.steps.map((s: any) => ({
          description: s.description,
          toolName: s.toolName,
        })),
        createdAt: e.createdAt,
        url: `${explainBase}/${e.id}`,
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
