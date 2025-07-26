import { QueryService } from "./QueryService";
import { EmbeddingHelper } from "./EmbeddingHelper";
import { DatabaseHelper } from "./DatabaseHelper";
import { ResourceResult, OntologyItem } from "../types";
import { getReadableName } from "../utils/formatting.js";
import Logger from "../utils/logger.js";

export class SearchService {
  private queryService: QueryService;
  private embeddingService: EmbeddingHelper;
  private databaseHelper: DatabaseHelper;

  constructor(
    queryService: QueryService,
    embeddingService: EmbeddingHelper,
    databaseService: DatabaseHelper
  ) {
    this.queryService = queryService;
    this.embeddingService = embeddingService;
    this.databaseHelper = databaseService;
  }

  public async exploreOntology(
    source: string,
    onProgress?: (processed: number, total?: number) => void
  ): Promise<void> {
    if (!(await this.databaseHelper.needsExploration(source))) {
      Logger.info("Ontology exploration already completed for this source.");
      return;
    }

    const ontologyMap = new Map<string, OntologyItem>();
    let processedTotal = 0;

    Logger.info(`Starting ontology exploration with source: ${source}`);
    const bindings = await this.queryOntologyAll(source);

    Logger.info(
      `Fetched ${bindings.length} ontological constructs from SPARQL endpoint`
    );

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

    if (onProgress) {
      onProgress(processedTotal);
    }

    Logger.info("=== Ontology Exploration Complete ===");
    Logger.info(
      `Total unique ontological constructs discovered: ${ontologyMap.size}`
    );
    Logger.info(`Total discovered: ${processedTotal}`);

    await this.saveOntologyWithEmbeddings(ontologyMap, source);
  }

  private async queryOntologyAll(source: string): Promise<any[]> {
    let query = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      SELECT DISTINCT ?uri ?label ?description`;

    query += `  WHERE {
      {
        ?uri rdf:type ?ty .
        FILTER(?ty IN (rdfs:Class, rdf:Property, owl:Class))
      } UNION {
        ?prop ?rangeDomain ?uri .
        FILTER(?rangeDomain IN (rdfs:domain, rdfs:range)) .
        BIND(<http://www.w3.org/2002/07/owl#Class> AS ?ty)
      }`;

    // Labels
    query += `
      OPTIONAL { ?uri rdfs:label ?rdfsLabel . FILTER(LANG(?rdfsLabel) = "en" || LANG(?rdfsLabel) = "") }
      OPTIONAL { ?uri <http://www.w3.org/2004/02/skos/core#prefLabel> ?skosLabel . FILTER(LANG(?skosLabel) = "en" || LANG(?skosLabel) = "") }
      OPTIONAL { ?uri <http://purl.org/dc/elements/1.1/title> ?dcTitle . FILTER(LANG(?dcTitle) = "en" || LANG(?dcTitle) = "") }
      BIND(COALESCE(?rdfsLabel, ?skosLabel, ?dcTitle) AS ?label)`;

    // Descriptions
    query += `
      OPTIONAL { ?uri rdfs:comment ?rdfsComment . FILTER(LANG(?rdfsComment) = "en" || LANG(?rdfsComment) = "") }
      OPTIONAL { ?uri <http://dbpedia.org/ontology/abstract> ?dboAbstract . FILTER(LANG(?dboAbstract) = "en" || LANG(?dboAbstract) = "") }
      OPTIONAL { ?uri <http://www.w3.org/2004/02/skos/core#definition> ?skosDefinition . FILTER(LANG(?skosDefinition) = "en" || LANG(?skosDefinition) = "") }
      OPTIONAL { ?uri <http://purl.org/dc/elements/1.1/description> ?dcDescription . FILTER(LANG(?dcDescription) = "en" || LANG(?dcDescription) = "") }
      BIND(COALESCE(?dboAbstract, ?rdfsComment, ?skosDefinition, ?dcDescription) AS ?description)`;

    query += `
      FILTER(!CONTAINS(STR(?uri), "http://www.w3.org/2002/07/owl#"))
      FILTER(!CONTAINS(STR(?uri), "http://www.openlinksw.com/schemas/"))
    }
    LIMIT 100000
    GROUP BY ?uri ?label ?description
    ORDER BY ?uri ?label ?description`;

    return await this.queryService.executeQuery(query, [source]);
  }

  public async searchOntology(
    userQuery: string,
    sparqlEndpoint: string,
    limit: number = 10
  ): Promise<
    Array<{
      uri: string;
      label: string;
      description: string;
      similarity: number;
    }>
  > {
    if (!sparqlEndpoint) {
      throw new Error("SPARQL endpoint not configured for search");
    }

    // Generate embedding for user query
    let queryVector: Float32Array | undefined;
    await this.embeddingService.embed(
      [userQuery],
      true,
      async (batchTexts, embeddings) => {
        queryVector = embeddings[0];
      }
    );

    if (!queryVector) {
      throw new Error("Failed to generate query embedding");
    }

    const results = await this.databaseHelper.searchOntology(
      queryVector,
      sparqlEndpoint,
      limit
    );

    return results.map((row: any) => ({
      uri: row.uri,
      label: row.label || getReadableName(row.uri),
      description: row.description || "No description available",
      similarity: row.similarity,
    }));
  }

  public async searchAll(
    searchQuery: string,
    sparqlEndpoint: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<ResourceResult[]> {
    if (!sparqlEndpoint) {
      throw new Error("SPARQL endpoint not configured for search");
    }

    // Build SPARQL query with Virtuoso's bif:contains
    let query = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX dbo: <http://dbpedia.org/ontology/>
      PREFIX bif: <http://www.openlinksw.com/schemas/bif#>
      
      # Pick longest label + longest description
      SELECT ?resource (MAX(?label) AS ?label) (MAX(?description) AS ?description) WHERE {
        ?resource rdfs:label ?label .
        FILTER(LANG(?label) = "en" || LANG(?label) = "")
        ?label bif:contains "'${searchQuery}'" .
        OPTIONAL { ?resource dbo:abstract ?abstract . FILTER(LANG(?abstract) = "en" || LANG(?abstract) = "") }
        OPTIONAL { ?resource rdfs:comment ?comment . FILTER(LANG(?comment) = "en" || LANG(?comment) = "") }
        BIND(COALESCE(?abstract, ?comment, "") AS ?description)
        `;

    // Add filters to exclude common schema types
    query += `
        FILTER(!CONTAINS(STR(?resource), "http://www.w3.org/2002/07/owl#"))
        FILTER(!CONTAINS(STR(?resource), "http://www.openlinksw.com/schemas/"))
        FILTER(?resource != <http://www.w3.org/1999/02/22-rdf-syntax-ns#Property>)
        FILTER(?resource != <http://www.w3.org/2000/01/rdf-schema#Class>)
      }
      GROUP BY ?resource
      ORDER BY ?resource
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const results = await this.queryService.executeQuery(query, [
      sparqlEndpoint,
    ]);

    return results
      .map((binding: any) => ({
        uri: binding.resource?.value || "",
        label: binding.label?.value,
        description: binding.description?.value,
      }))
      .filter((result) => result.uri); // Filter out empty URIs
  }

  public renderResourceResult(results: ResourceResult[]): string {
    if (results.length === 0) {
      return "No entities found matching your search query. Try different keywords or check if the entities exist in the knowledge graph.";
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

    return response;
  }

  public renderOntologyResult(
    results: Array<{
      uri: string;
      label: string;
      description: string;
      similarity: number;
    }>
  ): string {
    if (results.length === 0) {
      return "No similar ontological constructs found. Try a different query or the ontological constructs you're looking for might not be in the knowledge graph.";
    }

    return results
      .map(
        (res: any) =>
          `**${res.label || res.uri}**\n   - URI: ${
            res.uri
          }\n   - Similarity: ${res.similarity}\n   - Description: ${
            res.description || "No description available"
          }\n   - Use inspectURI to see full details`
      )
      .join("\n\n");
  }

  private async saveOntologyWithEmbeddings(
    ontologyMap: Map<string, OntologyItem>,
    sparqlEndpoint: string
  ): Promise<void> {
    const ontologyTexts: string[] = [];
    const ontologyInfos: OntologyItem[] = [];

    Logger.info("Preparing ontology texts for embedding...");
    // Prepare ontology texts for embedding (description || label)
    for (const onto of ontologyMap.values()) {
      const embeddingText =
        onto.description || onto.label || getReadableName(onto.uri);
      if (embeddingText) {
        ontologyTexts.push(embeddingText);
        ontologyInfos.push(onto);
      }
    }

    Logger.info(
      `Prepared ${ontologyTexts.length} ontological constructs for embedding`
    );

    // Generate embeddings in batch with callback to save immediately
    if (ontologyTexts.length > 0) {
      let processedCount = 0;
      await this.embeddingService.embed(
        ontologyTexts,
        false,
        async (batchTexts, embeddings) => {
          const batchOntologyItems = ontologyInfos.slice(
            processedCount,
            processedCount + batchTexts.length
          );
          const batchMap = new Map<string, OntologyItem>();
          batchOntologyItems.forEach((item) => batchMap.set(item.uri, item));
          await this.databaseHelper.saveOntologyToDatabase(
            batchMap,
            sparqlEndpoint,
            embeddings
          );

          processedCount += batchTexts.length;

          if (processedCount === ontologyInfos.length) {
            Logger.info(
              `All ${ontologyInfos.length} ontological constructs saved with embeddings`
            );
            // Record the endpoint that was used for this exploration
            await this.databaseHelper.recordEndpoint(sparqlEndpoint);
          }
        }
      );
    } else {
      Logger.warn("No ontological constructs to save to database");
    }
  }
}
