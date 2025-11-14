import { getDisplayName } from "@modelcontextprotocol/sdk/shared/metadataUtils.js";
import { getReadableName } from "../utils/formatting.js";
import { QueryService } from "./QueryService.js";
import { EmbeddingHelper } from "./EmbeddingHelper.js";
import { cos_sim } from "@huggingface/transformers";

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

export class InspectionService {
  constructor(
    private queryService: QueryService,
    private sparqlEndpoint: string,
    private embeddingHelper?: EmbeddingHelper
  ) {
    this.queryService = queryService;
    this.sparqlEndpoint = sparqlEndpoint;
    this.embeddingHelper = embeddingHelper;
  }

  public async inspect(
    uri: string,
    expandProperties: string[] = [],
    relevantToQuery?: string,
    maxResults?: number
  ): Promise<string> {
    // First try to inspect as ontology (class/property)
    const classResult = await this.inspectClass(uri);

    if (classResult.ranges.size > 0 || classResult.domains.size > 0) {
      return await formatOntologyInspectionResult(
        classResult,
        this.embeddingHelper,
        relevantToQuery,
        maxResults
      );
    }

    // If not a class, try to inspect as a property
    const propertyResult = await this.inspectProperty(uri);

    if (propertyResult) {
      return await formatPropertyInspectionResult(
        propertyResult,
        this.embeddingHelper,
        relevantToQuery,
        maxResults
      );
    }

    // If neither class nor property, try to inspect as data (instance/entity)
    const dataResult = await this.inspectData(
      uri,
      expandProperties,
      relevantToQuery,
      maxResults
    );

    // If data inspection found something, return it
    if (!dataResult.includes("No data connections found")) {
      return dataResult;
    }

    // If nothing worked, return a combined message
    return `No information found for URI: <${uri}>\n\nThis URI appears to be neither a class/property nor an instance with data connections in the knowledge graph.`;
  }

  /*
  Three cases:
  a) URI is a property: rdf:Property, owl:ObjectProperty, owl:DatatypeProperty, owl:FunctionalProperty, owl:InverseFunctionalProperty
  b) URI is a class: rdfs:Class, owl:Class
  c) URI is an instance/entity: has data connections
  */
  private async inspectProperty(
    uri: string
  ): Promise<{
    uri: string;
    label: string;
    description?: string;
    domains: Map<string, string>;
    ranges: Map<string, string>;
    domainHierarchies: Map<string, string>;
    rangeHierarchies: Map<string, string>;
  } | null> {
    let query = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX owl: <http://www.w3.org/2002/07/owl#>
      PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
      PREFIX dc: <http://purl.org/dc/elements/1.1/>
      SELECT ?propURI ?propLabel ?propDescr ?propRange ?propRangeLabel ?propDomain ?propDomainLabel WHERE {
        BIND(<${uri}> AS ?propURI) .
        
        # Get labels (rdfs:label, skos:prefLabel, dc:title)
        OPTIONAL { ?propURI rdfs:label ?rdfsLabel . FILTER(LANG(?rdfsLabel) = "en" || LANG(?rdfsLabel) = "") }
        OPTIONAL { ?propURI skos:prefLabel ?skosLabel . FILTER(LANG(?skosLabel) = "en" || LANG(?skosLabel) = "") }
        OPTIONAL { ?propURI dc:title ?dcTitle . FILTER(LANG(?dcTitle) = "en" || LANG(?dcTitle) = "") }
        BIND(COALESCE(?rdfsLabel, ?skosLabel, ?dcTitle) AS ?propLabel)

        # Get comments (rdfs:comment, skos:note, dc:description)
        OPTIONAL { ?propURI rdfs:comment ?rdfsComment . FILTER(LANG(?rdfsComment) = "en" || LANG(?rdfsComment) = "") }
        OPTIONAL { ?propURI skos:note ?skosNote . FILTER(LANG(?skosNote) = "en" || LANG(?skosNote) = "") }
        OPTIONAL { ?propURI dc:description ?dcDescr . FILTER(LANG(?dcDescr) = "en" || LANG(?dcDescr) = "") }
        BIND(COALESCE(?rdfsComment, ?skosNote, ?dcDescr) AS ?propDescr)

        ?propURI rdfs:domain ?propDomain .
        ?propURI rdfs:range ?propRange .
        

        # Get labels for range and domain properties
        OPTIONAL { ?propRange rdfs:label ?rangeRdfsLabel . FILTER(LANG(?rangeRdfsLabel) = "en" || LANG(?rangeRdfsLabel) = "") }
        OPTIONAL { ?propRange skos:prefLabel ?rangeSkosLabel . FILTER(LANG(?rangeSkosLabel) = "en" || LANG(?rangeSkosLabel) = "") }
        OPTIONAL { ?propRange dc:title ?rangeDcTitle . FILTER(LANG(?rangeDcTitle) = "en" || LANG(?rangeDcTitle) = "") }
        BIND(COALESCE(?rangeRdfsLabel, ?rangeSkosLabel, ?rangeDcTitle) AS ?propRangeLabel)

        OPTIONAL { ?propDomain rdfs:label ?domainRdfsLabel . FILTER(LANG(?domainRdfsLabel) = "en" || LANG(?domainRdfsLabel) = "") }
        OPTIONAL { ?propDomain skos:prefLabel ?domainSkosLabel . FILTER(LANG(?domainSkosLabel) = "en" || LANG(?domainSkosLabel) = "") }
        OPTIONAL { ?propDomain dc:title ?domainDcTitle . FILTER(LANG(?domainDcTitle) = "en" || LANG(?domainDcTitle) = "") }
        BIND(COALESCE(?domainRdfsLabel, ?domainSkosLabel, ?domainDcTitle) AS ?propDomainLabel)
      }`;

    const bindings = await this.queryService.executeQuery(query, [this.sparqlEndpoint]);

    // Check if the response contains results
    if (!bindings || bindings.length === 0) {
      return null;
    }

    let propLabel = getReadableName(uri, undefined);
    let propDescr: string | undefined;
    let propRange: Map<string, string> = new Map();
    let propDomain: Map<string, string> = new Map();
    let domainHierarchies: Map<string, string> = new Map();
    let rangeHierarchies: Map<string, string> = new Map();

    for (const binding of bindings) {
      if (binding.propRange && !propRange.has(binding.propRange.value)) {
        propRange.set(
          binding.propRange.value,
          binding.propRangeLabel?.value
            ? getFormattedLabel(binding.propRangeLabel.value)
            : getReadableName(binding.propRange.value)
        );
      }
      if (binding.propDomain && !propDomain.has(binding.propDomain.value)) {
        propDomain.set(
          binding.propDomain.value,
          binding.propDomainLabel?.value
            ? getFormattedLabel(binding.propDomainLabel.value)
            : getReadableName(binding.propDomain.value)
        );
      }
      if (binding.propLabel) {
        propLabel = getFormattedLabel(binding.propLabel.value);
      }
      if (binding.propDescr) {
        propDescr = binding.propDescr.value;
      }
    }

    // Fetch hierarchy information for each domain
    for (const domainUri of propDomain.keys()) {
      const hierarchyQuery = `
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        PREFIX owl: <http://www.w3.org/2002/07/owl#>
        SELECT (GROUP_CONCAT(DISTINCT ?parent; SEPARATOR = " -> ") AS ?hierarchy) WHERE {
          <${domainUri}> rdfs:subClassOf* ?parent .
          FILTER(?parent != <http://www.w3.org/2002/07/owl#Thing>)
        }
      `;
      const hierarchyBindings = await this.queryService.executeQuery(hierarchyQuery, [
        this.sparqlEndpoint,
      ]);
      if (
        hierarchyBindings &&
        hierarchyBindings.length > 0 &&
        hierarchyBindings[0].hierarchy
      ) {
        domainHierarchies.set(domainUri, hierarchyBindings[0].hierarchy.value);
      }
    }

    // Fetch hierarchy information for each range
    for (const rangeUri of propRange.keys()) {
      const hierarchyQuery = `
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        PREFIX owl: <http://www.w3.org/2002/07/owl#>
        SELECT (GROUP_CONCAT(DISTINCT ?parent; SEPARATOR = " -> ") AS ?hierarchy) WHERE {
          <${rangeUri}> rdfs:subClassOf* ?parent .
          FILTER(?parent != <http://www.w3.org/2002/07/owl#Thing>)
        }
      `;
      const hierarchyBindings = await this.queryService.executeQuery(hierarchyQuery, [
        this.sparqlEndpoint,
      ]);
      if (
        hierarchyBindings &&
        hierarchyBindings.length > 0 &&
        hierarchyBindings[0].hierarchy
      ) {
        rangeHierarchies.set(rangeUri, hierarchyBindings[0].hierarchy.value);
      }
    }

    if (propRange.size === 0 && propDomain.size === 0) {
      return null;
    }

    return {
      ranges: propRange,
      domains: propDomain,
      rangeHierarchies: rangeHierarchies,
      domainHierarchies: domainHierarchies,
      label: propLabel,
      description: propDescr,
      uri: uri,
    };
  }

  private async inspectClass(
    uri: string
  ): Promise<{
    ranges: Map<string, string>;
    domains: Map<string, string>;
    label: string;
    description: string | undefined;
    uri: string;
  }> {
    let ranges: Map<string, string> = new Map();
    let domains: Map<string, string> = new Map();
    let label: string = getReadableName(uri, undefined);
    let description: string | undefined;

  let query = `
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    PREFIX dc: <http://purl.org/dc/elements/1.1/>
    PREFIX dbo: <http://dbpedia.org/ontology/>
    SELECT DISTINCT ?classURI ?classLabel ?classDescr ?propRange ?propRangeLabel ?propDomain ?propDomainLabel WHERE {
      BIND(<${uri}> AS ?classURI) .

      # Get labels and description for the main class
      OPTIONAL { ?classURI rdfs:label ?rdfsLabel . FILTER(LANG(?rdfsLabel) = "en" || LANG(?rdfsLabel) = "") }
      OPTIONAL { ?classURI skos:prefLabel ?skosLabel . FILTER(LANG(?skosLabel) = "en" || LANG(?skosLabel) = "") }
      OPTIONAL { ?classURI dc:title ?dcTitle . FILTER(LANG(?dcTitle) = "en" || LANG(?dcTitle) = "") }
      BIND(COALESCE(?rdfsLabel, ?skosLabel, ?dcTitle) AS ?classLabel)

      OPTIONAL { ?classURI rdfs:comment ?rdfsComment . FILTER(LANG(?rdfsComment) = "en" || LANG(?rdfsComment) = "") }
      OPTIONAL { ?classURI skos:note ?skosNote . FILTER(LANG(?skosNote) = "en" || LANG(?skosNote) = "") }
      OPTIONAL { ?classURI dc:description ?dcDescription . FILTER(LANG(?dcDescription) = "en" || LANG(?dcDescription) = "") }
      OPTIONAL { ?classURI dbo:abstract ?dboAbstract . FILTER(LANG(?dboAbstract) = "en" || LANG(?dboAbstract) = "") }
      BIND(COALESCE(?rdfsComment, ?skosNote, ?dcDescription, ?dboAbstract) AS ?classDescr)

      # Find properties that have this class + parent classes (transitive closure) as range
      {
        SELECT DISTINCT ?propRange ?propRangeLabel WHERE {
          <${uri}> rdfs:subClassOf* ?rangeClass .
          ?propRange rdfs:range ?rangeClass .
          # Get labels for range properties
          OPTIONAL { ?propRange rdfs:label ?propRangeRdfsLabel . FILTER(LANG(?propRangeRdfsLabel) = "en" || LANG(?propRangeRdfsLabel) = "") }
          OPTIONAL { ?propRange skos:prefLabel ?propRangeSkosLabel . FILTER(LANG(?propRangeSkosLabel) = "en" || LANG(?propRangeSkosLabel) = "") }
          OPTIONAL { ?propRange dc:title ?propRangeDcTitle . FILTER(LANG(?propRangeDcTitle) = "en" || LANG(?propRangeDcTitle) = "") }
          BIND(COALESCE(?propRangeRdfsLabel, ?propRangeSkosLabel, ?propRangeDcTitle) AS ?propRangeLabel)
        } LIMIT 100000
      }
      
      # Find properties that have this class + parent classes (transitive closure) as domain
      {
        SELECT DISTINCT ?propDomain ?propDomainLabel WHERE {
          <${uri}> rdfs:subClassOf* ?domainClass .
          ?propDomain rdfs:domain ?domainClass .
          # Get labels for domain properties
          OPTIONAL { ?propDomain rdfs:label ?propDomainRdfsLabel . FILTER(LANG(?propDomainRdfsLabel) = "en" || LANG(?propDomainRdfsLabel) = "") }
          OPTIONAL { ?propDomain skos:prefLabel ?propDomainSkosLabel . FILTER(LANG(?propDomainSkosLabel) = "en" || LANG(?propDomainSkosLabel) = "") }
          OPTIONAL { ?propDomain dc:title ?propDomainDcTitle . FILTER(LANG(?propDomainDcTitle) = "en" || LANG(?propDomainDcTitle) = "") }
          BIND(COALESCE(?propDomainRdfsLabel, ?propDomainSkosLabel, ?propDomainDcTitle) AS ?propDomainLabel)
        } LIMIT 100000
      }
    } LIMIT 100000`;

  const bindings = await this.queryService.executeQuery(query, [this.sparqlEndpoint]);

  // Process results
  for (const binding of bindings) {
    if (binding.propRange) {
      if (!ranges.has(binding.propRange.value)) {
        ranges.set(
          binding.propRange.value,
          binding.propRangeLabel?.value
            ? getFormattedLabel(binding.propRangeLabel.value)
            : getReadableName(binding.propRange.value)
        );
      }
    }
    if (binding.propDomain) {
      if (!domains.has(binding.propDomain.value)) {
        domains.set(
          binding.propDomain.value,
          binding.propDomainLabel?.value
            ? getFormattedLabel(binding.propDomainLabel.value)
            : getReadableName(binding.propDomain.value)
        );
      }
    }
    if (binding.classLabel) {
      label = getFormattedLabel(binding.classLabel.value);
    }
    if (binding.classDescr) {
      description = binding.classDescr.value;
    }
  }

    return {
      ranges: ranges,
      domains: domains,
      label: label,
      description: description,
      uri: uri,
    };
  }

  private async inspectData(
    uri: string,
    expandProperties: string[] = [],
    relevantToQuery?: string,
    maxResults?: number
  ): Promise<string> {
    // Single query to get all connections with their values
    const query = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
      PREFIX dc: <http://purl.org/dc/elements/1.1/>
      PREFIX dct: <http://purl.org/dc/terms/>
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>

      SELECT DISTINCT ?property ?direction ?value WHERE {
        {
          # Outgoing connections: uri -> property -> value
          SELECT ?property ?value ?direction WHERE {
            <${uri}> ?property ?value .
            BIND("outgoing" AS ?direction)
            FILTER(!isLiteral(?value) || lang(?value) = "" || lang(?value) = "en")
          }
        }
        UNION
        {
          # Incoming connections: value -> property -> uri
          SELECT ?property ?value ?direction WHERE {
            ?value ?property <${uri}> .
            BIND("incoming" AS ?direction)
          }
        }
      }
      GROUP BY ?direction ?property ?value
      ORDER BY ?direction ?property ?value
    `;

    const bindings = await this.queryService.executeQuery(query, [this.sparqlEndpoint]);

    if (!bindings || bindings.length === 0) {
      return `No data connections found for URI: <${uri}>`;
    }

    // Group results by direction and property
    const outgoingData = new Map<
      string,
      Array<{ value: string; label?: string }>
    >();
    const incomingData = new Map<
      string,
      Array<{ value: string; label?: string }>
    >();

    for (const binding of bindings) {
      const propertyUri = binding.property?.value;
      const direction = binding.direction?.value;
      const value = binding.value?.value;

      if (!propertyUri || !value) continue;

      const valueEntry = { value, label: undefined };

      if (direction === "outgoing") {
        if (!outgoingData.has(propertyUri)) {
          outgoingData.set(propertyUri, []);
        }
        outgoingData.get(propertyUri)!.push(valueEntry);
      } else if (direction === "incoming") {
        if (!incomingData.has(propertyUri)) {
          incomingData.set(propertyUri, []);
        }
        incomingData.get(propertyUri)!.push(valueEntry);
      }
    }

    return await formatDataConnections(
      uri,
      outgoingData,
      incomingData,
      expandProperties,
      this.embeddingHelper,
      relevantToQuery,
      maxResults
    );
  }
}

async function formatPropertyInspectionResult(
  inspection: {
    uri: string;
    label: string;
    description?: string;
    domains: Map<string, string>;
    ranges: Map<string, string>;
    domainHierarchies: Map<string, string>;
    rangeHierarchies: Map<string, string>;
  },
  embeddingHelper?: EmbeddingHelper,
  relevantToQuery?: string,
  maxResults?: number
): Promise<string> {
  let result = `# Property: ${inspection.label}\nURI: <${inspection.uri}>\n\n`;

  // Add description if available
  if (inspection.description) {
    result += `## Description\n${inspection.description}\n\n`;
  }

  // Filter domains by relevance if query provided
  let filteredDomains = Array.from(inspection.domains.entries());
  let filteredRanges = Array.from(inspection.ranges.entries());

  if (relevantToQuery && embeddingHelper) {
    const [domainScores, rangeScores] = await Promise.all([
      rankByRelevance(
        filteredDomains.map(([uri, label]) => `${label}: ${uri}`),
        relevantToQuery,
        embeddingHelper
      ),
      rankByRelevance(
        filteredRanges.map(([uri, label]) => `${label}: ${uri}`),
        relevantToQuery,
        embeddingHelper
      ),
    ]);

    filteredDomains = filteredDomains
      .map(([uri, label], idx) => ({ uri, label, score: domainScores[idx] }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults || filteredDomains.length)
      .map(({ uri, label }) => [uri, label] as [string, string]);

    filteredRanges = filteredRanges
      .map(([uri, label], idx) => ({ uri, label, score: rangeScores[idx] }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults || filteredRanges.length)
      .map(({ uri, label }) => [uri, label] as [string, string]);
  } else if (maxResults) {
    filteredDomains = filteredDomains.slice(0, maxResults);
    filteredRanges = filteredRanges.slice(0, maxResults);
  }

  // Add domain information with hierarchy
  if (filteredDomains.length > 0) {
    result += `## Domain Classes (subjects that can use this property)\n\n`;
    result += "| URI | Label | Hierarchy |\n";
    result += "|-----|-------|----------|\n";
    for (const [uri, label] of filteredDomains) {
      const hierarchy = inspection.domainHierarchies.get(uri) || "";
      const escapedLabel = label.replace(/\|/g, "\\|");
      const escapedHierarchy = hierarchy.replace(/\|/g, "\\|");
      result += `| \`${uri}\` | ${escapedLabel} | ${escapedHierarchy} |\n`;
    }
    result += "\n";
  }

  // Add range information with hierarchy
  if (filteredRanges.length > 0) {
    result += `## Range Classes (objects this property can point to)\n\n`;
    result += "| URI | Label | Hierarchy |\n";
    result += "|-----|-------|----------|\n";
    for (const [uri, label] of filteredRanges) {
      const hierarchy = inspection.rangeHierarchies.get(uri) || "";
      const escapedLabel = label.replace(/\|/g, "\\|");
      const escapedHierarchy = hierarchy.replace(/\|/g, "\\|");
      result += `| \`${uri}\` | ${escapedLabel} | ${escapedHierarchy} |\n`;
    }
    result += "\n";
  }

  // Add general SPARQL example
  result += `## SPARQL Usage:\n`;
  result += `?subject <${inspection.uri}> ?object\n\n`;

  // Add summary
  const domainCount = filteredDomains.length;
  const rangeCount = filteredRanges.length;
  const totalDomains = inspection.domains.size;
  const totalRanges = inspection.ranges.size;

  if (relevantToQuery || maxResults) {
    result += `## Showing: ${domainCount} of ${totalDomains} domains, ${rangeCount} of ${totalRanges} ranges`;
    if (relevantToQuery) {
      result += ` (filtered by: "${relevantToQuery}")`;
    }
    result += `\n`;
  } else {
    result += `## Total: ${domainCount} domains, ${rangeCount} ranges\n`;
  }

  return result;
}

async function rankByRelevance(
  texts: string[],
  query: string,
  embeddingHelper: EmbeddingHelper
): Promise<number[]> {
  const queryEmbedding: Float32Array[] = [];
  const textEmbeddings: Float32Array[] = [];

  // Get query embedding with instruction (for property relevance matching)
  await embeddingHelper.embed([query], "query_property", async (_, embeddings) => {
    queryEmbedding.push(...embeddings);
  });

  // Get text embeddings without instruction (these are already formatted descriptions)
  await embeddingHelper.embed(texts, "none", async (_, embeddings) => {
    textEmbeddings.push(...embeddings);
  });

  // Calculate similarities using transformers' cos_sim
  return textEmbeddings.map((textEmbed) =>
    cos_sim(Array.from(queryEmbedding[0]), Array.from(textEmbed))
  );
}

async function formatOntologyInspectionResult(
  inspection: {
    ranges: Map<string, string>;
    domains: Map<string, string>;
    label: string;
    description?: string;
    uri: string;
  },
  embeddingHelper?: EmbeddingHelper,
  relevantToQuery?: string,
  maxResults?: number
): Promise<string> {
  let result = `# Class: ${inspection.label}\nURI: <${inspection.uri}>\n\n`;

  if (inspection.description) {
    result += `## Description\n${inspection.description}\n\n`;
  }

  let filteredDomains = Array.from(inspection.domains.entries());
  let filteredRanges = Array.from(inspection.ranges.entries());

  if (relevantToQuery && embeddingHelper) {
    const [domainScores, rangeScores] = await Promise.all([
      rankByRelevance(
        filteredDomains.map(([uri, label]) => `${label}: ${uri}`),
        relevantToQuery,
        embeddingHelper
      ),
      rankByRelevance(
        filteredRanges.map(([uri, label]) => `${label}: ${uri}`),
        relevantToQuery,
        embeddingHelper
      ),
    ]);

    filteredDomains = filteredDomains
      .map(([uri, label], idx) => ({ uri, label, score: domainScores[idx] }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults || filteredDomains.length)
      .map(({ uri, label }) => [uri, label] as [string, string]);

    filteredRanges = filteredRanges
      .map(([uri, label], idx) => ({ uri, label, score: rangeScores[idx] }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults || filteredRanges.length)
      .map(({ uri, label }) => [uri, label] as [string, string]);
  } else if (maxResults) {
    filteredDomains = filteredDomains.slice(0, maxResults);
    filteredRanges = filteredRanges.slice(0, maxResults);
  }

  if (filteredDomains.length > 0) {
    result += `## Outgoing connections (Properties)\n\n`;
    result += "| URI | Label |\n";
    result += "|-----|-------|\n";
    for (const [uri, label] of filteredDomains) {
      const escapedLabel = label.replace(/\|/g, "\\|");
      result += `| \`${uri}\` | ${escapedLabel} |\n`;
    }
    result += "\n";
  }

  if (filteredRanges.length > 0) {
    result += `## Incoming connections (Properties)\n\n`;
    result += "| URI | Label |\n";
    result += "|-----|-------|\n";
    for (const [uri, label] of filteredRanges) {
      const escapedLabel = label.replace(/\|/g, "\\|");
      result += `| \`${uri}\` | ${escapedLabel} |\n`;
    }
    result += "\n";
  }

  const domainCount = filteredDomains.length;
  const rangeCount = filteredRanges.length;
  const totalDomains = inspection.domains.size;
  const totalRanges = inspection.ranges.size;

  if (relevantToQuery || maxResults) {
    result += `## Showing: ${domainCount} of ${totalDomains} outgoing connections, ${rangeCount} of ${totalRanges} incoming connections`;
    if (relevantToQuery) {
      result += ` (filtered by: "${relevantToQuery}")`;
    }
    result += `\n`;
  } else {
    result += `## Total: ${domainCount} outgoing connections, ${rangeCount} incoming connections\n`;
  }

  return result;
}

// Helper function to format a single value entry
function formatValue(valueEntry: { value: string; label?: string }): string {
  if (
    valueEntry.value.startsWith("http://") ||
    valueEntry.value.startsWith("https://")
  ) {
    return `    - ${valueEntry.value} (URI)\n`;
  }
  return `    - ${valueEntry.value}\n`;
}

// Helper function to format value for table display
function formatValueForTable(valueEntry: { value: string; label?: string }): string {
  if (
    valueEntry.value.startsWith("http://") ||
    valueEntry.value.startsWith("https://")
  ) {
    return getReadableName(valueEntry.value);
  }
  return valueEntry.value;
}

// Helper function to format property section
function formatPropertySection(
  propertyIndex: number,
  propertyUri: string,
  values: Array<{ value: string; label?: string }>,
  isExpanded: boolean,
  valueLabel: string
): string {
  let section = `${propertyIndex}. ${propertyUri}\n`;

  if (isExpanded) {
    section += `   ${valueLabel} (${values.length}):\n`;
    section += values.map(formatValue).join("");
  } else {
    // Show preview of first few values
    section += `   ${valueLabel} (${values.length}):\n`;
    const limitedValues = values.slice(0, MAX_VALUES_TO_SHOW);
    section += limitedValues.map(formatValue).join("");
    if (values.length > MAX_VALUES_TO_SHOW) {
      section += `    - ... and ${
        values.length - MAX_VALUES_TO_SHOW
      } more ${valueLabel.toLowerCase()}\n`;
    }
  }
  return section + "\n";
}

const MAX_VALUES_TO_SHOW = 2;

async function formatDataConnections(
  uri: string,
  outgoingData: Map<string, Array<{ value: string; label?: string }>>,
  incomingData: Map<string, Array<{ value: string; label?: string }>>,
  expandProperties: string[],
  embeddingHelper?: EmbeddingHelper,
  relevantToQuery?: string,
  maxResults?: number
): Promise<string> {
  let result = `# Data connections for: ${getReadableName(
    uri
  )}\nURI: <${uri}>\n\n`;

  let filteredOutgoing = Array.from(outgoingData.entries());
  let filteredIncoming = Array.from(incomingData.entries());

  // Filter by relevance if query provided
  if (relevantToQuery && embeddingHelper) {
    const [outgoingScores, incomingScores] = await Promise.all([
      rankByRelevance(
        filteredOutgoing.map(([uri, _]) => getReadableName(uri)),
        relevantToQuery,
        embeddingHelper
      ),
      rankByRelevance(
        filteredIncoming.map(([uri, _]) => getReadableName(uri)),
        relevantToQuery,
        embeddingHelper
      ),
    ]);

    filteredOutgoing = filteredOutgoing
      .map(([uri, values], idx) => ({ uri, values, score: outgoingScores[idx] }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults || filteredOutgoing.length)
      .map(({ uri, values }) => [uri, values] as [string, Array<{ value: string; label?: string }>]);

    filteredIncoming = filteredIncoming
      .map(([uri, values], idx) => ({ uri, values, score: incomingScores[idx] }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults || filteredIncoming.length)
      .map(({ uri, values }) => [uri, values] as [string, Array<{ value: string; label?: string }>]);
  } else if (maxResults) {
    filteredOutgoing = filteredOutgoing.slice(0, maxResults);
    filteredIncoming = filteredIncoming.slice(0, maxResults);
  }

  if (filteredOutgoing.length > 0) {
    result += `## Properties (${filteredOutgoing.length}${
      relevantToQuery || maxResults ? ` of ${outgoingData.size}` : ""
    })\n`;
    result += `*<${uri}> --[Property]--> [Sample Values]*\n\n`;
    result += "| Property | Count | Sample Values |\n";
    result += "|----------|-------|---------------|\n";
    
    for (const [propertyUri, values] of filteredOutgoing) {
      const isExpanded = expandProperties.includes(propertyUri);
      const sampleValues = isExpanded 
        ? values.map(v => formatValueForTable(v)).join(", ")
        : values.slice(0, 2).map(v => formatValueForTable(v)).join(", ") + 
          (values.length > 2 ? `, ... (+${values.length - 2} more)` : "");
      
      const escapedSamples = sampleValues.replace(/\|/g, "\\|").replace(/\n/g, " ");
      result += `| \`${propertyUri}\` | ${values.length} | ${escapedSamples} |\n`;
    }
    result += "\n";
  }

  if (filteredIncoming.length > 0) {
    result += `## References (${filteredIncoming.length}${
      relevantToQuery || maxResults ? ` of ${incomingData.size}` : ""
    })\n`;
    result += `*[Sample Entities] --[Property]--> <${uri}>*\n\n`;
    result += "| Property | Count | Sample Entities |\n";
    result += "|----------|-------|----------------|\n";
    
    for (const [propertyUri, values] of filteredIncoming) {
      const isExpanded = expandProperties.includes(propertyUri);
      const sampleValues = isExpanded 
        ? values.map(v => formatValueForTable(v)).join(", ")
        : values.slice(0, 2).map(v => formatValueForTable(v)).join(", ") + 
          (values.length > 2 ? `, ... (+${values.length - 2} more)` : "");
      
      const escapedSamples = sampleValues.replace(/\|/g, "\\|").replace(/\n/g, " ");
      result += `| ${propertyUri} | ${values.length} | ${escapedSamples} |\n`;
    }
    result += "\n";
  }

  result += `## Summary\n`;
  if (relevantToQuery || maxResults) {
    result += `- Showing: ${filteredOutgoing.length} of ${outgoingData.size} properties, ${filteredIncoming.length} of ${incomingData.size} references`;
    if (relevantToQuery) {
      result += ` (filtered by: "${relevantToQuery}")`;
    }
    result += `\n`;
  } else {
    result += `- Total: ${outgoingData.size} properties, ${incomingData.size} references\n`;
  }

  return result;
}

