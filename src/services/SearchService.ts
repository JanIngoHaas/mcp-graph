import { QueryService } from './QueryService';
import { EmbeddingService } from './EmbeddingService';
import { DatabaseService } from './DatabaseService';
import { ResourceResult, OntologyItem, ExplorationOptions } from '../types';
import { getReadableName } from '../utils.js';

export class SearchService {
  private queryService: QueryService;
  private embeddingService: EmbeddingService;
  private databaseService: DatabaseService;

  constructor(queryService: QueryService, embeddingService: EmbeddingService, databaseService: DatabaseService) {
    this.queryService = queryService;
    this.embeddingService = embeddingService;
    this.databaseService = databaseService;
  }


  async exploreOntology(
    sources: string[],
    options: ExplorationOptions = {}
  ): Promise<Map<string, OntologyItem>> {
    const batchSize = options.batchSize || 100;
    const ontologyMap = new Map<string, OntologyItem>();

    let offset = 0;
    let processedTotal = 0;
    let hasMore = true;

    console.error(`Starting ontology exploration with sources: ${sources.join(', ')}`);
    console.error(`Batch size: ${batchSize}, Include labels: ${options.includeLabels}, Include descriptions: ${options.includeDescriptions}`);

    while (hasMore) {
      try {
        const bindings = await this.queryOntologyBatch(sources, options, offset, batchSize);

        console.error(`Fetched ${bindings.length} ontological constructs from SPARQL endpoint (offset: ${offset})`);

        if (bindings.length === 0) {
          console.error('No more ontological constructs returned, ending exploration');
          hasMore = false;
          break;
        }

        for (const binding of bindings) {
          const ontologyUri = binding.uri?.value;
          const label = binding.label?.value;
          const description = binding.description?.value;

          if (!ontologyUri) continue;

          if (!ontologyMap.has(ontologyUri)) {
            ontologyMap.set(ontologyUri, {
              uri: ontologyUri,
              description,
              label,
            });
          }
        }

        processedTotal += bindings.length;
        offset += batchSize;
        hasMore = bindings.length === batchSize;

        if (options.onProgress) {
          options.onProgress(processedTotal);
        }
      } catch (error) {
        console.error(`Error querying SPARQL endpoint at offset ${offset}:`, error);
        hasMore = false;
      }
    }

    console.error(`\n=== Ontology Exploration Complete ===`);
    console.error(`Total unique ontological constructs discovered: ${ontologyMap.size}`);
    console.error(`Total bindings processed: ${processedTotal}`);

    return ontologyMap;
  }

  private async queryOntologyBatch(
    sources: string[],
    options: ExplorationOptions,
    offset: number,
    batchSize: number
  ): Promise<any[]> {
    let query = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      SELECT DISTINCT ?uri`;

    if (options.includeLabels) {
      query += ` ?label`;
    }

    if (options.includeDescriptions) {
      query += ` ?description`;
    }

    query += ` WHERE {
      {
        ?uri rdf:type ?ty .
        FILTER(?ty IN (rdfs:Class, rdf:Property, owl:Class))
      }`;

    if (options.includeLabels) {
      query += `
      OPTIONAL { ?uri rdfs:label ?rdfsLabel . FILTER(LANG(?rdfsLabel) = "en" || LANG(?rdfsLabel) = "") }
      OPTIONAL { ?uri <http://www.w3.org/2004/02/skos/core#prefLabel> ?skosLabel . FILTER(LANG(?skosLabel) = "en" || LANG(?skosLabel) = "") }
      OPTIONAL { ?uri <http://purl.org/dc/elements/1.1/title> ?dcTitle . FILTER(LANG(?dcTitle) = "en" || LANG(?dcTitle) = "") }
      BIND(COALESCE(?rdfsLabel, ?skosLabel, ?dcTitle) AS ?label)`;
    }

    if (options.includeDescriptions) {
      query += `
      OPTIONAL { ?uri rdfs:comment ?rdfsComment . FILTER(LANG(?rdfsComment) = "en" || LANG(?rdfsComment) = "") }
      OPTIONAL { ?uri <http://dbpedia.org/ontology/abstract> ?dboAbstract . FILTER(LANG(?dboAbstract) = "en" || LANG(?dboAbstract) = "") }
      OPTIONAL { ?uri <http://www.w3.org/2004/02/skos/core#definition> ?skosDefinition . FILTER(LANG(?skosDefinition) = "en" || LANG(?skosDefinition) = "") }
      OPTIONAL { ?uri <http://purl.org/dc/elements/1.1/description> ?dcDescription . FILTER(LANG(?dcDescription) = "en" || LANG(?dcDescription) = "") }
      BIND(COALESCE(?dboAbstract, ?rdfsComment, ?skosDefinition, ?dcDescription) AS ?description)`;
    }

    query += `
      FILTER(!CONTAINS(STR(?uri), "http://www.w3.org/2002/07/owl#"))
      FILTER(!CONTAINS(STR(?uri), "http://www.openlinksw.com/schemas/"))
    }
    ORDER BY ?uri ?type
    LIMIT ${batchSize}
    OFFSET ${offset}`;

    return await this.queryService.executeQuery(query, sources);
  }

  async searchOntology(userQuery: string, sparqlEndpoint: string, limit: number = 10): Promise<Array<{ uri: string, label: string, description: string, similarity: number }>> {
    if (!sparqlEndpoint) {
      throw new Error('SPARQL endpoint not configured for search');
    }

    // Generate embedding for user query
    const queryEmbedding = await this.embeddingService.embed([userQuery], 'Given a search query, retrieve a list of semantically similar ontological constructs');
    const queryVector = queryEmbedding[0];

    const results = await this.databaseService.searchOntology(queryVector, sparqlEndpoint, limit);

    return results.map((row: any) => ({
      uri: row.uri,
      label: row.label || getReadableName(row.uri),
      description: row.description || 'No description available',
      similarity: row.similarity
    }));
  }

  async searchAll(searchQuery: string, sparqlEndpoint: string, limit: number = 20, offset: number = 0): Promise<ResourceResult[]> {
    if (!sparqlEndpoint) {
      throw new Error('SPARQL endpoint not configured for search');
    }

    // Build SPARQL query with Virtuoso's bif:contains
    let query = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX dbo: <http://dbpedia.org/ontology/>
      PREFIX bif: <http://www.openlinksw.com/schemas/bif#>
      
      SELECT DISTINCT ?resource ?label (COALESCE(?abstract, ?comment) AS ?description) WHERE {
        ?resource rdfs:label ?label .
        ?label bif:contains "'${searchQuery}'" .
        OPTIONAL { ?resource dbo:abstract ?abstract . FILTER(LANG(?abstract) = "en" || LANG(?abstract) = "") }
        OPTIONAL { ?resource rdfs:comment ?comment . FILTER(LANG(?comment) = "en" || LANG(?comment) = "") }`;

    // Add filters to exclude common schema types
    query += `
        FILTER(!CONTAINS(STR(?resource), "http://www.w3.org/2002/07/owl#"))
        FILTER(!CONTAINS(STR(?resource), "http://www.openlinksw.com/schemas/"))
        FILTER(?resource != <http://www.w3.org/1999/02/22-rdf-syntax-ns#Property>)
        FILTER(?resource != <http://www.w3.org/2000/01/rdf-schema#Class>)
      }
      ORDER BY ?resource
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    try {
      const results = await this.queryService.executeQuery(query, [sparqlEndpoint]);

      return results.map((binding: any) => ({
        uri: binding.resource?.value || '',
        label: binding.label?.value,
        description: binding.description?.value
      })).filter(result => result.uri); // Filter out empty URIs
    } catch (error) {
      throw error;
    }
  }

  async saveOntologyWithEmbeddings(ontologyMap: Map<string, OntologyItem>, sparqlEndpoint: string): Promise<void> {
    const ontologyTexts: string[] = [];
    const ontologyInfos: OntologyItem[] = [];

    console.error('Preparing ontology texts for embedding...');
    // Prepare ontology texts for embedding (description || label)
    for (const onto of ontologyMap.values()) {
      const embeddingText = onto.description || onto.label || getReadableName(onto.uri);
      if (embeddingText) {
        ontologyTexts.push(embeddingText);
        ontologyInfos.push(onto);
      }
    }

    console.error(`Prepared ${ontologyTexts.length} ontological constructs for embedding`);

    // Generate embeddings in batch
    if (ontologyTexts.length > 0) {
      const embeddings = await this.embeddingService.embed(ontologyTexts);
      await this.databaseService.saveOntologyToDatabase(ontologyMap, sparqlEndpoint, embeddings);
    } else {
      console.error('No ontological constructs to save to database');
    }

    // Record the endpoint that was used for this exploration
    await this.databaseService.recordEndpoint(sparqlEndpoint);
  }
}