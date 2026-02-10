import { getReadableName, formatUriOrPrefixedName } from "../utils/sparqlFormatting.js";
import { QueryService } from "./QueryService.js";
import { EmbeddingHelper } from "./EmbeddingHelper.js";
import { cos_sim } from "@huggingface/transformers";
import { PrefixManager } from "../utils/PrefixManager.js";
import type {
  InspectionResult,
  ClassInspection,
  PropertyInspection,
  EntityInspection,
  DataConnectionValue,
} from "../types/index.js";

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

  /**
   * Inspect a URI and return structured data about it.
   * The caller is responsible for formatting the result for agent or user.
   */
  public async inspect(
    uri: string,
    expandProperties: string[] = []
  ): Promise<InspectionResult> {
    // First try to inspect as ontology (class/property)
    const classResult = await this.inspectClass(uri);

    if (classResult.ranges.size > 0 || classResult.domains.size > 0) {
      return {
        type: "class",
        data: classResult,
      };
    }

    // If not a class, try to inspect as a property
    const propertyResult = await this.inspectProperty(uri);

    if (propertyResult) {
      return {
        type: "property",
        data: propertyResult,
      };
    }

    // If neither class nor property, try to inspect as data (instance/entity)
    const entityResult = await this.inspectEntity(uri, expandProperties);

    if (entityResult) {
      return {
        type: "entity",
        data: entityResult,
      };
    }

    // If nothing worked, return not found
    return { type: "notFound", uri };
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
      SELECT ?propURI ?propLabel ?propDescr ?propRange ?propRangeLabel ?propDomain ?propDomainLabel WHERE {
        BIND(${formatUriOrPrefixedName(uri)} AS ?propURI) .
        
        OPTIONAL { ?propURI rdfs:label ?propLabel }
        OPTIONAL { ?propURI rdfs:comment ?propDescr }

        ?propURI rdfs:domain ?propDomain .
        ?propURI rdfs:range ?propRange .
        
        OPTIONAL { ?propRange rdfs:label ?propRangeLabel }
        OPTIONAL { ?propDomain rdfs:label ?propDomainLabel }
      }`;

    const bindings = await this.queryService.executeQueryRaw(query, [this.sparqlEndpoint]);

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
          ${formatUriOrPrefixedName(domainUri)} rdfs:subClassOf* ?parent .
          FILTER(?parent != <http://www.w3.org/2002/07/owl#Thing>)
        }
      `;
      const hierarchyBindings = await this.queryService.executeQueryRaw(hierarchyQuery, [
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
          ${formatUriOrPrefixedName(rangeUri)} rdfs:subClassOf* ?parent .
          FILTER(?parent != <http://www.w3.org/2002/07/owl#Thing>)
        }
      `;
      const hierarchyBindings = await this.queryService.executeQueryRaw(hierarchyQuery, [
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
      BIND(${formatUriOrPrefixedName(uri)} AS ?classURI) .

      OPTIONAL { ?classURI rdfs:label ?classLabel }
      OPTIONAL { ?classURI rdfs:comment ?classDescr }

      # Find properties that have this class + parent classes (transitive closure) as range
      {
        SELECT DISTINCT ?propRange ?propRangeLabel WHERE {
          <${uri}> rdfs:subClassOf* ?rangeClass .
          ?propRange rdfs:range ?rangeClass .
          OPTIONAL { ?propRange rdfs:label ?propRangeLabel }
        } LIMIT 100000
      }
      
      # Find properties that have this class + parent classes (transitive closure) as domain
      {
        SELECT DISTINCT ?propDomain ?propDomainLabel WHERE {
          <${uri}> rdfs:subClassOf* ?domainClass .
          ?propDomain rdfs:domain ?domainClass .
          OPTIONAL { ?propDomain rdfs:label ?propDomainLabel }
        } LIMIT 100000
      }
    } LIMIT 100000`;

    const bindings = await this.queryService.executeQueryRaw(query, [this.sparqlEndpoint]);

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

  /**
   * Inspect an entity and return structured data about its connections.
   * Returns null if no connections found.
   */
  private async inspectEntity(
    uri: string,
    expandProperties: string[] = []
  ): Promise<EntityInspection | null> {
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
            ${formatUriOrPrefixedName(uri)} ?property ?value .
            BIND("outgoing" AS ?direction)
          }
        }
        UNION
        {
          # Incoming connections: value -> property -> uri
          SELECT ?property ?value ?direction WHERE {
            ?value ?property ${formatUriOrPrefixedName(uri)} .
            BIND("incoming" AS ?direction)
          }
        }
      }
      GROUP BY ?direction ?property ?value
      ORDER BY ?direction ?property ?value
    `;

    const bindings = await this.queryService.executeQueryRaw(query, [this.sparqlEndpoint]);

    if (!bindings || bindings.length === 0) {
      return null;
    }

    // Group results by direction and property
    const outgoing = new Map<string, DataConnectionValue[]>();
    const incoming = new Map<string, DataConnectionValue[]>();

    for (const binding of bindings) {
      const propertyUri = binding.property?.value;
      const direction = binding.direction?.value;
      const value = binding.value?.value;

      if (!propertyUri || !value) continue;

      const valueEntry: DataConnectionValue = { value, label: undefined };

      if (direction === "outgoing") {
        if (!outgoing.has(propertyUri)) {
          outgoing.set(propertyUri, []);
        }
        outgoing.get(propertyUri)!.push(valueEntry);
      } else if (direction === "incoming") {
        if (!incoming.has(propertyUri)) {
          incoming.set(propertyUri, []);
        }
        incoming.get(propertyUri)!.push(valueEntry);
      }
    }

    return {
      uri,
      label: getReadableName(uri),
      outgoing,
      incoming,
      expandedProperties: expandProperties,
    };
  }

  /**
   * Helper to get the EmbeddingHelper for use in formatters
   */
  public getEmbeddingHelper(): EmbeddingHelper | undefined {
    return this.embeddingHelper;
  }
}



