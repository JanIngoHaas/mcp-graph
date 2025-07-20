import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { QueryService } from './services/QueryService.js';
import { SearchService } from './services/SearchService.js';
import { InspectionService } from './services/InspectionService.js';
import { EmbeddingService } from './services/EmbeddingService.js';
import { DatabaseService } from './services/DatabaseService.js';
import { ResourceResult } from './types.js';

export function createServer(dbPath?: string, sparqlEndpoint?: string): McpServer {
  const server = new McpServer({
    name: 'rdfGraph',
    version: '0.1.0',
  });

  // Initialize services
  const queryService = new QueryService();
  const embeddingService = new EmbeddingService();
  const databaseService = new DatabaseService(dbPath);
  const searchService = new SearchService(queryService, embeddingService, databaseService);
  const inspectionService = new InspectionService(queryService);

  // Initialize exploration on startup if SPARQL endpoint is provided
  if (sparqlEndpoint) {
    databaseService.needsExploration(sparqlEndpoint).then(async (needsExploration: boolean) => {
      if (needsExploration) {
        console.error('Starting ontology exploration from SPARQL endpoint...');
        const ontologyMap = await searchService.exploreOntology([sparqlEndpoint], {
          includeLabels: true,
          includeDescriptions: true,
          batchSize: 50,
          onProgress: (processed: number) => {
            console.error(`Processed ${processed} ontological constructs...`);
          }
        });
        await searchService.saveOntologyWithEmbeddings(ontologyMap, sparqlEndpoint);
        console.error('Ontology exploration completed.');
      } else {
        console.error('Database already contains data for this endpoint, skipping exploration.');
      }
    }).catch((error: any) => {
      console.error('Ontology exploration failed:', error);
    });
  }

  server.registerTool("makeQuery", {
    description: "Send a SPARQL query to the Knowledge Graph. Search for useable properties first to know what to query.",
    inputSchema: {
      query: z.string().describe('The SPARQL query to execute - must be a valid SPARQL query. Define any PREFIXes yourself if needed.'),
    },
  }, async (request: { query: string }) => {
    const { query } = request;
    const res = await queryService.executeQuery(query, [sparqlEndpoint || '']);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(res, null, 2),
        },
      ],
    };
  });

  // Register the search ontology tool
  server.registerTool(
    'searchOntology',
    {
      description: 'Search for RDF ontological constructs (classes, properties, datatypes, etc.) by their purpose and meaning. Returns ontology URIs - use inspectURI for full details. Examples: "person birth date" (finds birthDate property), "location coordinates" (finds geographic properties), "organization class" (finds Organization class)',
      inputSchema: {
        query: z.string().describe('The natural language search query'),
        limit: z.number().optional().default(10).describe('Maximum number of results to return (default: 10)'),
      },
    },
    async (request: { query: string; limit: number }) => {
    const { query, limit } = request;
    
    if (!query) {
      throw new Error('Query parameter is required');
    }

    const results = await searchService.searchOntology(query, sparqlEndpoint || '', limit);
    
    if (results.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No similar ontological constructs found. Try a different query or the ontological constructs you\'re looking for might not be in the knowledge graph.',
          },
        ],
      };
    }

    let response = results.map((res: any) => `**${res.label || res.uri}**\n   - URI: ${res.uri}\n   - Similarity: ${res.similarity}\n   - Description: ${res.description || 'No description available'}\n   - Use inspectURI to see full details`).join('\n\n');
  
    return {
      content: [
        {
          type: 'text',
          text: response,
        },
      ],
    };
  });

  // Register the search all tool
  server.registerTool(
    'searchAll',
    {
      description: 'Search for any RDF entities (resources, individuals, concepts) using syntactic full-text search. Examples: "Einstein" (finds Albert Einstein), "quantum*" (finds quantum mechanics, quantum physics)',
      inputSchema: {
        query: z.string().describe('The search query to find entities. Uses syntactic full-match search with wildcard support (e.g., "Einstein", "quantum*")'),
        limit: z.number().optional().default(20).describe('Maximum number of results to return (default: 20)'),
        offset: z.number().optional().default(0).describe('Number of results to skip for pagination (default: 0)'),
      },
    },
    async (request: { query: string; limit: number; offset: number }) => {
      const { query, limit, offset } = request;
      
      if (!query) {
        throw new Error('Query parameter is required');
      }

      if (!sparqlEndpoint) {
        throw new Error('SPARQL endpoint not configured');
      }

      const results = await searchService.searchAll(query, sparqlEndpoint, limit, offset);
      
      if (results.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No entities found matching your search query. Try different keywords or check if the entities exist in the knowledge graph.',
            },
          ],
        };
      }

      let response = `Found ${results.length} entities:\n\n`;
      results.forEach((resource: ResourceResult, index: number) => {
        response += `${index + 1}. **${resource.label || resource.uri}**\n`;
        response += `   - URI: ${resource.uri}\n`;
        if (resource.label && resource.label !== resource.uri) {
          response += `   - Label: ${resource.label}\n`;
        }
        if (resource.description) {
          response += `   - Description: ${resource.description}\n`;
        }
        if (resource.type) {
          response += `   - Type: ${resource.type}\n`;
        }
        response += `   - Use inspectURI to see full details\n\n`;
      });

      return {
        content: [
          {
            type: 'text',
            text: response,
          },
        ],
      };
    }
  );

  // Register the inspect URI tool
  server.registerTool(
    'inspectURI',
    {
      description: 'Inspect any URI to see all its properties and values. Works with resources, properties, classes, domains, ranges, etc. Examples: "http://dbpedia.org/resource/Albert_Einstein" (inspect Einstein), "http://dbpedia.org/ontology/birthDate" (inspect birthDate property)',
      inputSchema: {
        uri: z.string().describe('The URI to inspect - can be a resource, property, class, domain, range, or any other URI'),
      },
    },
    async (request: { uri: string }) => {
      const { uri } = request;
      
      if (!uri) {
        throw new Error('URI parameter is required');
      }

      if (!sparqlEndpoint) {
        throw new Error('SPARQL endpoint not configured');
      }

      try {
        const result = await inspectionService.inspect(uri, sparqlEndpoint || '');
        
        return {
          content: [
            {
              type: 'text',
              text: result,
            },
          ],
        };
      } catch (error) {
        throw new Error(`Failed to inspect resource: ${error}`);
      }
    }
  );

  return server;
}