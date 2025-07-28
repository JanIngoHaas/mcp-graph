import { QueryService } from "./QueryService";
import { EmbeddingHelper } from "./EmbeddingHelper";
import { DatabaseHelper } from "./DatabaseHelper";
import { ResourceResult, OntologyItem } from "../types";
import { getReadableName } from "../utils/formatting.js";
import Logger from "../utils/logger.js";

/**
 * Checks if a label appears to be a URI (starts with http/https)
 */
function isUriLabel(label: string): boolean {
  return label.startsWith("http://") || label.startsWith("https://");
}

/**
 * Gets a properly formatted label, using getReadableName for URI labels
 */
function getFormattedLabel(label: string): string {
  if (isUriLabel(label)) return getReadableName(label);
  return label;
}

/**
 * Generates smart property descriptions from domain/range relationships
 */
function generatePropertyDescription(
  propertyLabel: string,
  domainLabel: string,
  rangeLabel: string
): string {
  const formattedProperty = getFormattedLabel(propertyLabel);
  const formattedDomain = getFormattedLabel(domainLabel);
  const formattedRange = getFormattedLabel(rangeLabel);

  return `[${formattedDomain}]--[${formattedProperty}]-->[${formattedRange}]`;
}

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

    Logger.info(`Starting ontology exploration with source: ${source}`);

    // Process classes and properties separately
    await this.processClasses(source, onProgress);
    await this.processProperties(source, onProgress);

    // Record the endpoint that was used for this exploration
    await this.databaseHelper.recordEndpoint(source);

    Logger.info("=== Ontology Exploration Complete ===");
  }

  private async processClasses(
    source: string,
    onProgress?: (processed: number, total?: number) => void
  ): Promise<void> {
    Logger.info("Processing classes...");
    const classBindings = await this.queryOntologyAllClasses(source);
    Logger.info(`Fetched ${classBindings.length} classes from SPARQL endpoint`);

    const classMap = new Map<string, OntologyItem>();

    for (const binding of classBindings) {
      const ontologyUri = binding.uri?.value;
      const rawLabel = binding.label?.value;
      const description = binding.description?.value;

      if (!ontologyUri) continue;

      const label = getFormattedLabel(rawLabel);

      if (!classMap.has(ontologyUri)) {
        classMap.set(ontologyUri, {
          uri: ontologyUri,
          description,
          label,
        });
      }
    }

    if (onProgress) {
      onProgress(classBindings.length);
    }

    Logger.info(`Total unique classes discovered: ${classMap.size}`);
    await this.saveClassesWithEmbeddings(classMap, source);
  }

  private async processProperties(
    source: string,
    onProgress?: (processed: number, total?: number) => void
  ): Promise<void> {
    Logger.info("Processing properties...");
    const propertyBindings = await this.queryOntologyAllProperties(source);
    Logger.info(
      `Fetched ${propertyBindings.length} properties from SPARQL endpoint`
    );

    const propertyMap = new Map<string, OntologyItem>();

    for (const binding of propertyBindings) {
      const ontologyUri = binding.uri?.value;
      const rawLabel = binding.label?.value;
      const domainLabel = binding.domainLabel?.value;
      const rangeLabel = binding.rangeLabel?.value;

      if (!ontologyUri || !domainLabel || !rangeLabel) continue;

      const label = getFormattedLabel(rawLabel);

      // Generate smart property description
      const smartDescription = generatePropertyDescription(
        label,
        domainLabel,
        rangeLabel
      );

      if (!propertyMap.has(ontologyUri)) {
        propertyMap.set(ontologyUri, {
          uri: ontologyUri,
          description: smartDescription,
          label,
        });
      }
    }

    if (onProgress) {
      onProgress(propertyBindings.length);
    }

    Logger.info(`Total unique properties discovered: ${propertyMap.size}`);
    await this.savePropertiesWithEmbeddings(propertyMap, source);
  }

  private async queryOntologyAllClasses(source: string): Promise<any[]> {
    const query = `
    PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    PREFIX dc: <http://purl.org/dc/elements/1.1/>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX dbo: <http://dbpedia.org/ontology/>
    PREFIX foaf: <http://xmlns.com/foaf/0.1/>
    SELECT DISTINCT ?uri ?label ?description
    WHERE {
      # We actually want to find all types that are used as domains / ranges somewhere - otherwise they have no use for the exploration
      ?prop ?dr ?uri .
      FILTER(?dr IN (rdfs:domain, rdfs:range))
      
      # Multiple label options
      OPTIONAL { ?uri rdfs:label ?rdfsLabel . FILTER(LANG(?rdfsLabel) = "en" || LANG(?rdfsLabel) = "") }
      OPTIONAL { ?uri skos:prefLabel ?skosLabel . FILTER(LANG(?skosLabel) = "en" || LANG(?skosLabel) = "") }
      OPTIONAL { ?uri dc:title ?dcTitle . FILTER(LANG(?dcTitle) = "en" || LANG(?dcTitle) = "") }
      OPTIONAL { ?uri dct:title ?dctTitle . FILTER(LANG(?dctTitle) = "en" || LANG(?dctTitle) = "") }
      OPTIONAL { ?uri foaf:name ?foafName . FILTER(LANG(?foafName) = "en" || LANG(?foafName) = "") }
      
      # Multiple description options
      OPTIONAL { ?uri dbo:abstract ?dboAbstract . FILTER(LANG(?dboAbstract) = "en" || LANG(?dboAbstract) = "") }
      OPTIONAL { ?uri rdfs:comment ?rdfsComment . FILTER(LANG(?rdfsComment) = "en" || LANG(?rdfsComment) = "") }
      OPTIONAL { ?uri skos:definition ?skosDefinition . FILTER(LANG(?skosDefinition) = "en" || LANG(?skosDefinition) = "") }
      OPTIONAL { ?uri dc:description ?dcDescription . FILTER(LANG(?dcDescription) = "en" || LANG(?dcDescription) = "") }
      OPTIONAL { ?uri dct:description ?dctDescription . FILTER(LANG(?dctDescription) = "en" || LANG(?dctDescription) = "") }
      OPTIONAL { ?uri skos:note ?skosNote . FILTER(LANG(?skosNote) = "en" || LANG(?skosNote) = "") }
      
      BIND(COALESCE(?rdfsLabel, ?skosLabel, ?dcTitle, ?dctTitle, ?foafName, STR(?uri)) AS ?label)
      BIND(COALESCE(?dboAbstract, ?rdfsComment, ?skosDefinition, ?dcDescription, ?dctDescription, ?skosNote) AS ?description)

      # Exclude meta-schemas and structural vocabularies
      FILTER(!CONTAINS(STR(?uri), "http://www.openlinksw.com/schemas/"))
      FILTER(!CONTAINS(STR(?uri), "http://www.w3.org/2002/07/owl#"))
      FILTER(!CONTAINS(STR(?uri), "http://www.w3.org/1999/02/22-rdf-syntax-ns#"))
      FILTER(!CONTAINS(STR(?uri), "http://www.w3.org/2000/01/rdf-schema#"))

      }`;

    return await this.queryService.executeQuery(query, [source]);
  }

  private async queryOntologyAllProperties(source: string): Promise<any[]> {
    const query = `
    PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX owl: <http://www.w3.org/2002/07/owl#>
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    PREFIX dc: <http://purl.org/dc/elements/1.1/>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX dbo: <http://dbpedia.org/ontology/>
    PREFIX foaf: <http://xmlns.com/foaf/0.1/>
    SELECT DISTINCT ?uri ?label ?domain ?range ?domainLabel ?rangeLabel
    WHERE {
      ?uri rdf:type ?propType .
      FILTER(?propType IN (rdf:Property, owl:ObjectProperty, owl:DatatypeProperty, owl:AnnotationProperty))
      
      # Require domain and range - filter out useless properties
      ?uri rdfs:domain ?domain .
      ?uri rdfs:range ?range .
      
      # Property label options
      OPTIONAL { ?uri rdfs:label ?rdfsLabel . FILTER(LANG(?rdfsLabel) = "en" || LANG(?rdfsLabel) = "") }
      OPTIONAL { ?uri skos:prefLabel ?skosLabel . FILTER(LANG(?skosLabel) = "en" || LANG(?skosLabel) = "") }
      OPTIONAL { ?uri dc:title ?dcTitle . FILTER(LANG(?dcTitle) = "en" || LANG(?dcTitle) = "") }
      OPTIONAL { ?uri dct:title ?dctTitle . FILTER(LANG(?dctTitle) = "en" || LANG(?dctTitle) = "") }
      OPTIONAL { ?uri foaf:name ?foafName . FILTER(LANG(?foafName) = "en" || LANG(?foafName) = "") }
      
      # Domain label options
      OPTIONAL { ?domain rdfs:label ?domainRdfsLabel . FILTER(LANG(?domainRdfsLabel) = "en" || LANG(?domainRdfsLabel) = "") }
      OPTIONAL { ?domain skos:prefLabel ?domainSkosLabel . FILTER(LANG(?domainSkosLabel) = "en" || LANG(?domainSkosLabel) = "") }
      OPTIONAL { ?domain dc:title ?domainDcTitle . FILTER(LANG(?domainDcTitle) = "en" || LANG(?domainDcTitle) = "") }
      
      # Range label options
      OPTIONAL { ?range rdfs:label ?rangeRdfsLabel . FILTER(LANG(?rangeRdfsLabel) = "en" || LANG(?rangeRdfsLabel) = "") }
      OPTIONAL { ?range skos:prefLabel ?rangeSkosLabel . FILTER(LANG(?rangeSkosLabel) = "en" || LANG(?rangeSkosLabel) = "") }
      OPTIONAL { ?range dc:title ?rangeDcTitle . FILTER(LANG(?rangeDcTitle) = "en" || LANG(?rangeDcTitle) = "") }
      
      BIND(COALESCE(?rdfsLabel, ?skosLabel, ?dcTitle, ?dctTitle, ?foafName, STR(?uri)) AS ?label)
      BIND(COALESCE(?domainRdfsLabel, ?domainSkosLabel, ?domainDcTitle, STR(?domain)) AS ?domainLabel)
      BIND(COALESCE(?rangeRdfsLabel, ?rangeSkosLabel, ?rangeDcTitle, STR(?range)) AS ?rangeLabel)

      # Exclude meta-schemas and structural vocabularies
      FILTER(!CONTAINS(STR(?uri), "http://www.openlinksw.com/schemas/"))
      FILTER(!CONTAINS(STR(?uri), "http://www.w3.org/2002/07/owl#"))
      FILTER(!CONTAINS(STR(?uri), "http://www.w3.org/1999/02/22-rdf-syntax-ns#"))
      FILTER(!CONTAINS(STR(?uri), "http://www.w3.org/2000/01/rdf-schema#"))
      
      # Same for domain and range
      FILTER(!CONTAINS(STR(?domain), "http://www.openlinksw.com/schemas/"))
      FILTER(!CONTAINS(STR(?domain), "http://www.w3.org/2002/07/owl#"))
      FILTER(!CONTAINS(STR(?domain), "http://www.w3.org/1999/02/22-rdf-syntax-ns#"))
      FILTER(!CONTAINS(STR(?domain), "http://www.w3.org/2000/01/rdf-schema#"))
      
      FILTER(!CONTAINS(STR(?range), "http://www.openlinksw.com/schemas/"))
      FILTER(!CONTAINS(STR(?range), "http://www.w3.org/2002/07/owl#"))
      FILTER(!CONTAINS(STR(?range), "http://www.w3.org/1999/02/22-rdf-syntax-ns#"))
      FILTER(!CONTAINS(STR(?range), "http://www.w3.org/2000/01/rdf-schema#"))
    }
  `;

    return await this.queryService.executeQuery(query, [source]);
  }

  public async searchOntology(
    userQuery: string,
    searchType: "class" | "property",
    limit: number = 10,
    sparqlEndpoint: string
  ): Promise<
    Array<{
      uri: string;
      label: string;
      description: string;
      similarity: number;
    }>
  > {
    // Generate embedding for user query
    let queryVector: Float32Array | undefined;
    await this.embeddingService.embed(
      [userQuery],
      searchType === "class" ? "query_class" : "query_property",
      async (batchTexts, embeddings) => {
        queryVector = embeddings[0];
        Logger.info(
          `Generated embedding for user query: "${
            batchTexts[0]
          }" - Vector dimensions: ${
            embeddings[0].length
          }, First 5 values: [${Array.from(embeddings[0].slice(0, 5))
            .map((v) => v.toFixed(4))
            .join(", ")}]`
        );
      }
    );

    if (!queryVector) {
      throw new Error("Failed to generate query embedding");
    }

    const results = await this.databaseHelper.searchOntologyWithVector(
      queryVector,
      searchType,
      sparqlEndpoint,
      limit
    );

    return results.map((row: any) => ({
      uri: row.uri,
      label: getFormattedLabel(row.label),
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
      PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
      PREFIX dc: <http://purl.org/dc/elements/1.1/>
      PREFIX dct: <http://purl.org/dc/terms/>
      PREFIX dbo: <http://dbpedia.org/ontology/>
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>
      PREFIX bif: <http://www.openlinksw.com/schemas/bif#>
      
      # Pick longest label + longest description
      SELECT ?resource (MAX(?finalLabel) AS ?label) (MAX(?finalDescription) AS ?description) WHERE {
        ?resource ?labelProp ?searchLabel .
        FILTER(?labelProp IN (rdfs:label, skos:prefLabel, dc:title, dct:title, foaf:name))
        FILTER(LANG(?searchLabel) = "en" || LANG(?searchLabel) = "")
        ?searchLabel bif:contains "'${searchQuery}'" .
        
        # Multiple label options for final result
        OPTIONAL { ?resource rdfs:label ?rdfsLabel . FILTER(LANG(?rdfsLabel) = "en" || LANG(?rdfsLabel) = "") }
        OPTIONAL { ?resource skos:prefLabel ?skosLabel . FILTER(LANG(?skosLabel) = "en" || LANG(?skosLabel) = "") }
        OPTIONAL { ?resource dc:title ?dcTitle . FILTER(LANG(?dcTitle) = "en" || LANG(?dcTitle) = "") }
        OPTIONAL { ?resource foaf:name ?foafName . FILTER(LANG(?foafName) = "en" || LANG(?foafName) = "") }
        
        # Multiple description options
        OPTIONAL { ?resource dbo:abstract ?abstract . FILTER(LANG(?abstract) = "en" || LANG(?abstract) = "") }
        OPTIONAL { ?resource rdfs:comment ?comment . FILTER(LANG(?comment) = "en" || LANG(?comment) = "") }
        OPTIONAL { ?resource skos:definition ?definition . FILTER(LANG(?definition) = "en" || LANG(?definition) = "") }
        OPTIONAL { ?resource dc:description ?dcDesc . FILTER(LANG(?dcDesc) = "en" || LANG(?dcDesc) = "") }
        OPTIONAL { ?resource dct:description ?dctDesc . FILTER(LANG(?dctDesc) = "en" || LANG(?dctDesc) = "") }
        
        BIND(COALESCE(?rdfsLabel, ?skosLabel, ?dcTitle, ?foafName, STR(?resource)) AS ?finalLabel)
        BIND(COALESCE(?abstract, ?comment, ?definition, ?dcDesc, ?dctDesc, "") AS ?finalDescription)
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
      .map((binding: any) => {
        const uri = binding.resource?.value || "";
        const rawLabel = binding.label?.value;
        return {
          uri,
          label: rawLabel ? getFormattedLabel(rawLabel) : getReadableName(uri),
          description: binding.description?.value,
        };
      })
      .filter((result) => result.uri); // Filter out empty URIs
  }

  public renderResourceResult(results: ResourceResult[]): string {
    if (results.length === 0) {
      return "No entities found matching your search query. Try different keywords or check if the entities exist in the knowledge graph.";
    }

    let response = `Found ${results.length} entities:\n\n`;
    results.forEach((resource: ResourceResult, index: number) => {
      response += `${index + 1}. **${
        resource.label || getReadableName(resource.uri)
      }**\n`;
      response += `   - URI: ${resource.uri}\n`;
      if (resource.label && resource.label !== getReadableName(resource.uri)) {
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
          `**${res.label || getReadableName(res.uri)}**\n   - URI: ${
            res.uri
          }\n   - Similarity: ${res.similarity}\n   - Description: ${
            res.description || "No description available"
          }\n   - Use inspectURI to see full details`
      )
      .join("\n\n");
  }

  private async saveClassesWithEmbeddings(
    classMap: Map<string, OntologyItem>,
    sparqlEndpoint: string
  ): Promise<void> {
    const classTexts: string[] = [];
    const classInfos: OntologyItem[] = [];

    Logger.info("Preparing class texts for embedding...");
    for (const classItem of classMap.values()) {
      const embeddingText =
        classItem.description ||
        classItem.label ||
        getReadableName(classItem.uri);
      if (embeddingText) {
        classTexts.push(embeddingText);
        classInfos.push(classItem);
      }
    }

    Logger.info(`Prepared ${classTexts.length} classes for embedding`);

    if (classTexts.length > 0) {
      const allEmbeddings: Float32Array[] = [];
      let processedCount = 0;

      await this.embeddingService.embed(
        classTexts,
        "none",
        async (batchTexts, embeddings) => {
          allEmbeddings.push(...embeddings);
          processedCount += batchTexts.length;
          Logger.info(
            `Collected embeddings for ${processedCount}/${classTexts.length} classes`
          );
        }
      );

      Logger.info(
        "Saving all class embeddings to database in single transaction..."
      );
      await this.databaseHelper.saveClassesToDatabase(
        classMap,
        sparqlEndpoint,
        allEmbeddings
      );
    } else {
      Logger.warn("No classes to save to database");
    }
  }

  private async savePropertiesWithEmbeddings(
    propertyMap: Map<string, OntologyItem>,
    sparqlEndpoint: string
  ): Promise<void> {
    const propertyTexts: string[] = [];
    const propertyInfos: OntologyItem[] = [];

    Logger.info("Preparing property texts for embedding...");
    for (const propertyItem of propertyMap.values()) {
      // Use the smart-generated description for properties
      const embeddingText = propertyItem.description;

      propertyTexts.push(embeddingText);
      propertyInfos.push(propertyItem);
    }

    Logger.info(`Prepared ${propertyTexts.length} properties for embedding`);

    if (propertyTexts.length > 0) {
      const allEmbeddings: Float32Array[] = [];
      let processedCount = 0;

      await this.embeddingService.embed(
        propertyTexts,
        "none",
        async (batchTexts, embeddings) => {
          allEmbeddings.push(...embeddings);
          processedCount += batchTexts.length;
          Logger.info(
            `Collected embeddings for ${processedCount}/${propertyTexts.length} properties`
          );
        }
      );

      Logger.info(
        "Saving all property embeddings to database in single transaction..."
      );
      await this.databaseHelper.savePropertiesToDatabase(
        propertyMap,
        sparqlEndpoint,
        allEmbeddings
      );
    } else {
      Logger.warn("No properties to save to database");
    }
  }
}
