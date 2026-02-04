import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { QueryService } from "./services/QueryService.js";
import { SearchService } from "./services/SearchService.js";
import { InspectionService } from "./services/InspectionService.js";
import { TripleService } from "./services/TripleService.js";
import { QueryBuilderService } from "./services/QueryBuilderService.js";
import { ExplanationService } from "./services/ExplanationService.js";
import { formatQuadsToMarkdown, formatQuadsToTtl, formatInspectionForAgent, formatResourceResultForAgent, formatTriplesForAgent, formatQueryBuilderResultForAgent } from "./utils/formatting/index.js";
import { EmbeddingHelper } from "./services/EmbeddingHelper.js";
import { CitationDatabase } from "./utils/CitationDatabase.js";
import { ExplanationDatabase } from "./utils/ExplanationDatabase.js";
import { Explanation, ExplanationStep } from "./types/index.js";

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

Usage Information:
1) [EXPLAINABLE] Use 'search' to find relevant entities, classes, and properties for your topic
2) [EXPLAINABLE] Use 'inspect' on interesting URIs to understand their relationships and properties
3) Use 'query' to execute precise SPARQL queries based on your discoveries. NOTE: Raw SPARQL is NOT explainable in the final report.
4) [EXPLAINABLE] [CITABLE] Use 'fact' to check facts (simple pattern matching). This tool can be CITED.
5) [EXPLAINABLE] [CITABLE] Use 'query_builder' to build explainable queries more easily. This tool can be CITED.
6) Use 'cite' to activate a citation for a fact or query you have verified.

WORKFLOW FOR COMPLEX QUESTIONS:
1) Use 'search' to find relevant entities, classes, and properties
2) Use 'inspect' to understand URIs and their relationships  
3) Use 'fact' (simple) or 'query_builder' (complex) to verify claims. Retrieve the "Citation Key".
4) Use 'cite' with the Key to get a [Source](...) link.
5) Use 'explain' as your FINAL output with:
   - title: A descriptive title
   - answer: Your complete response with embedded citation links (from step 4)
   - steps: The verification steps (Execution Keys) + description so users can re-execute and verify

The 'explain' tool creates an interactive page showing your answer with citations and verification steps.

CITATION FORMAT: The 'cite' tool returns Markdown links like [Source](...). Embed these directly in your answer text.
PREFER query_builder: Always prefer 'query_builder' over raw 'query' for finding evidence, as only 'query_builder' is fully explainable in the final interactive report. You may use 'query' for ultra-precise queries.`,
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

  // Helper function to standardize tool execution, referencing, and citations
  const handleToolExecution = async (
    toolName: string,
    request: any,
    extra: any,
    executor: () => Promise<{
      text: string;
      citation?: {
        type: "triple" | "collection";
        data: any; // The result/quads
        description?: string; // For query_builder
      };
    }>,
    options: { explainable?: boolean } = { explainable: true }
  ) => {
    const sessionId = checkSession(extra);

    // Execute the specific tool logic
    const result = await executor();

    // Log Execution (Explainable)
    let explainMsg = "";
    if (options.explainable) {
      const executionId = explanationDb.logExecution(sessionId, toolName, request);
      explainMsg = `\n\nExecution Key: ${executionId}. Call 'explain' with this key and an explanation to give the user insight into your reasoning.`;
    }

    // Log Citation (if provided)
    let citationMsg = "";
    if (result.citation) {
      let citationId;
      if (result.citation.type === "triple") {
        citationId = citationDb.storeCitation(sessionId, result.citation.data);
      } else {
        citationId = citationDb.storeQueryBuilderCitation(
          sessionId,
          result.citation.data,
          result.citation.description || ""
        );
      }
      citationMsg = `\n\nCitation Key: ${citationId}. Call 'cite' with this key to generate a verification link.`;
    }

    // Combine Output
    return {
      content: [
        {
          type: "text" as const,
          text: result.text + citationMsg + explainMsg,
        },
      ],
    };
  };

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
    async (request: { query: string; language: string; maxRows?: number }, extra: any) => {
      return handleToolExecution("query", request, extra, async () => {
        const { query, language, maxRows = 100 } = request;
        const res = await queryService.executeQuery(query, [sparqlEndpoint], language, maxRows);
        return { text: res };
      }, { explainable: false });
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
      .describe("The RDF class URI to query."),
    filters: z
      .array(
        z.object({
          path: z
            .string()
            .describe("Property path, use `->` between segments. Allowed segments: full URIs (e.g., https://example.org/property) or prefixed names (e.g., schema:email). Example: `https://example.org/relatedTo -> rdfs:label` or `kg:relatedTo -> rdfs:label`."),
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
      .describe("Property paths to return as columns (e.g., `['rdfs:label', 'kg:year']`). Use `->` between segments. Allowed segments: full URIs or prefixed names."),
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
        "[EXPLAINABLE] [CITABLE] Verify specific relationships or find missing values. Returns a citation key that can be used with the 'cite' tool (to prove your claims). Use wildcard '_' to discover unknown parts of a triple. Use this tool for simple factoid questions or to verify a single or multiple simple claims precisely. Do not use this tool for complex queries that require complex multiple steps or joins.",
      inputSchema: FactInputSchema,
    },
    async (request: FactRequest, extra: any) => {
      return handleToolExecution("fact", request, extra, async () => {
        const { subject, predicate, object, limit } = request;
        const result = await tripleService.completeTriple(subject, predicate, object, limit);

        if (result.length === 0) {
          return { text: "No matching triples found." };
        }

        // Format as Markdown for the model
        const md = formatTriplesForAgent(result);

        return {
          text: md,
          citation: {
            type: "triple",
            data: result,
          },
        };
      });
    }
  );

  // Register the generic cite tool
  server.registerTool(
    "cite",
    {
      description:
        "Activate a citation. Pass the 'key' you received from 'fact' or 'query_builder' to generate a permanent user-facing link that the user can open in their browser and view to verify your claims!",
      inputSchema: {
        key: z.string().describe("The citation key to activate")
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
        `[EXPLAINABLE] [CITABLE] Build and execute structured queries with relationship traversal. Returns a citation key that can be used with the 'cite' tool (to prove your claims). Use this tool to filter lists of entities.\n\nKey Features:\n- Path Traversal: Use \`->\` between segments (e.g., 'kg:relatedTo -> rdfs:label' checks the label of the related entity).\n- Multiple Filters: Combine multiple conditions.\n- JSON Escaping: If a string contains double quotes, escape them per JSON.\n- Prefixes: \`kg:\` is a placeholder prefix; use a prefix that exists in your KG.\n\nExample: "Find items where a related label contains 'Example' and year is after 2020"\n{\n  "type": "kg:Item",\n  "filters": [\n    { "path": "kg:relatedTo -> rdfs:label", "operator": "contains", "value": "Example" },\n    { "path": "kg:year", "operator": ">", "value": "2020" }\n  ],\n  "project": ["rdfs:label", "kg:year", "kg:relatedTo -> rdfs:label"]\n}`,
      inputSchema: QueryBuilderInputSchema,
    },
    async (request: QueryBuilderRequest, extra: any) => {
      return handleToolExecution("query_builder", request, extra, async () => {
        const { type, filters, project, limit } = request;

        try {
          // Transform filters to proper type
          const typedFilters = filters?.map((f) => ({
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
          const markdown = formatQueryBuilderResultForAgent(result);

          // Generate description for citation
          const description = await queryBuilderService.generateDescription({
            type,
            filters: typedFilters,
            project,
            limit,
          });

          return {
            text: markdown,
            citation: {
              type: "collection",
              data: result,
              description,
            },
          };
        } catch (error) {
          return { text: `Error executing query: ${error}` };
        }
      });
    }
  );

  // Register the search all tool
  server.registerTool(
    "search",
    {
      description:
        `[EXPLAINABLE] Search for RDF entities using boolean queries.`,
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
    async (request: { query: string; limit: number; offset: number }, extra: any) => {
      return handleToolExecution("search", request, extra, async () => {
        const { query, limit, offset } = request;

        if (!query) {
          throw new Error("Query parameter is required");
        }

        // Trim any leading/trailing single quotes from query
        const trimmedQuery = query.replace(/^'|'$/g, "");

        const results = await searchService.searchAll(
          trimmedQuery,
          sparqlEndpoint,
          limit,
          offset
        );

        const response = formatResourceResultForAgent(results);
        return { text: response };
      });
    }
  );

  // Register the unified inspect tool
  server.registerTool(
    "inspect",
    {
      description:
        '[EXPLAINABLE] Inspect any URI in the knowledge graph. Shows relationships and properties for classes, properties, or entities.',
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
      },
    },
    async (
      request: {
        uri: string;
        expandProperties?: string[];
      },
      extra: any
    ) => {
      return handleToolExecution("inspect", request, extra, async () => {
        const {
          uri,
          expandProperties = [],
        } = request;

        try {
          const result = await inspectionService.inspect(
            uri,
            expandProperties
          );

          return { text: formatInspectionForAgent(result) };
        } catch (error) {
          throw new Error(`Failed to inspect URI: ${error}`);
        }
      });
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

  // Register the explain tool for creating reproducible explanations
  server.registerTool(
    "explain",
    {
      description:
        "Create an interactive explanation page with your answer and the steps you took. This is your FINAL output for complex questions. The 'answer' field contains your response with embedded citation links (from cite_xxx tools). The 'steps' field links to SOME of your previous tool executions.",
      inputSchema: {
        success: z.boolean().describe("A flag indicating if you found what the user has asked for. Set to true if that is the case, otherwise, set it to false"),
        title: z
          .string()
          .describe("A descriptive title for this explanation (e.g., 'Finding papers by Martin Gaedke')"),
        answer: z
          .string()
          .describe("Your complete answer to the user's question, with embedded citation links using [Source](...) links from the cite tool"),
        steps: z
          .array(
            z.object({
              executionKey: z
                .string()
                .describe("The Execution Key returned by a previous tool execution (search, inspect, etc.)"),
              description: z
                .string()
                .describe("Human-readable description of what this step did and why you took it (e.g., 'I used the ID from the previous step to find his publications')"),
            })
          )
          .describe("The ordered list of verification steps that led to your answer, referencing previous tool executions. NOTE: Only include steps that were successful and relevant to the final answer. Disregard any steps that didn't contribute to the final answer."),
      },
    },
    async (
      request: {
        success: boolean;
        title: string;
        answer: string;
        steps: Array<{
          executionKey: string;
          description: string;
        }>;
      },
      extra: any
    ) => {
      const { title, answer, steps, success } = request;
      const sessionId = extra?.sessionId;

      // if success==true: 
      // Check if we have citation data - if not => return to the model telling it that it has to cite the answer triples!
      // If success==false, then fine. Also adapt this behavior in the user interface (i.e. change the green checkmark to a red cross or whatever in case shit hit the fan and success==false!)

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

      if (success) {
        const activeCitations = citationDb.getCitationsForSession(sessionId);
        if (activeCitations.length === 0) {
          return {
            content: [
              {
                type: "text",
                text:
                  "Error: Missing citations. If success is true, you must call 'cite' to activate citation keys and include the resulting [Source](...) links in your answer before calling 'explain'.",
              },
            ],
          };
        }
      }

      // Resolve execution keys to actual tool parameters
      const resolvedSteps: any[] = [];
      const missingKeys: string[] = [];

      for (const step of steps) {
        const execution = explanationDb.getExecution(step.executionKey);
        if (!execution) {
          missingKeys.push(step.executionKey);
          continue;
        }
        resolvedSteps.push({
          description: step.description,
          executionKey: step.executionKey,
          toolName: execution.toolName,
          toolParams: execution.params
        });
      }

      if (missingKeys.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Could not find tool executions for keys: ${missingKeys.join(", ")}. Please ensure you are using valid Execution Keys returned by the tools.`,
            },
          ],
        };
      }

      const explanationId = explanationService.storeExplanation(sessionId, title, answer, resolvedSteps, success);
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

      const responseData = explanations.map((e: Explanation) => ({
        id: e.id,
        sessionId: e.sessionId,
        title: e.title,
        answer: e.answer,
        success: e.success,
        stepCount: e.steps.length,
        steps: e.steps.map((s: ExplanationStep) => ({
          description: s.description,
          toolName: s.toolName,
          toolParams: s.toolParams,
          executionKey: s.executionKey,
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
