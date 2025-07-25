import { getDisplayName } from "@modelcontextprotocol/sdk/shared/metadataUtils.js";
import { getReadableName } from "../utils.js";
import { QueryService } from "./QueryHelper.js";

export class InspectionService {
  constructor(private queryService: QueryService) {
    this.queryService = queryService;
  }

  public async inspect(uri: string, sparqlEndpoint: string): Promise<string> {
    return await inspect(uri, sparqlEndpoint, this.queryService);
  }
}

/*
Three cases:
a) URI is a property: rdf:Property, owl:ObjectProperty, owl:DatatypeProperty, owl:FunctionalProperty, owl:InverseFunctionalProperty
b) URI is a class: rdfs:Class, owl:Class
*/
async function inspectProperty(
  uri: string,
  sparqlEndpoint: string,
  queryService: QueryService
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

  const bindings = await queryService.executeQuery(query, [sparqlEndpoint]);

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
        getReadableName(binding.propRange.value, binding.propRangeLabel?.value)
      );
    }
    if (binding.propDomain && !propDomain.has(binding.propDomain.value)) {
      propDomain.set(
        binding.propDomain.value,
        getReadableName(
          binding.propDomain.value,
          binding.propDomainLabel?.value
        )
      );
    }
    if (binding.propLabel) {
      propLabel = binding.propLabel.value;
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
    const hierarchyBindings = await queryService.executeQuery(hierarchyQuery, [sparqlEndpoint]);
    if (hierarchyBindings && hierarchyBindings.length > 0 && hierarchyBindings[0].hierarchy) {
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
    const hierarchyBindings = await queryService.executeQuery(hierarchyQuery, [sparqlEndpoint]);
    if (hierarchyBindings && hierarchyBindings.length > 0 && hierarchyBindings[0].hierarchy) {
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

async function inspectClass(
  uri: string,
  sparqlEndpoint: string,
  queryService: QueryService
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

      # Find properties that have ANY class in the hierarchy as range
      OPTIONAL {
        SELECT DISTINCT ?propRange ?propRangeLabel WHERE {
          <${uri}> rdfs:subClassOf* ?rangeClass .
          ?propRange rdfs:range ?rangeClass .
          #FILTER(?rangeClass != <http://www.w3.org/2002/07/owl#Thing> && ?rangeClass != <http://www.w3.org/2000/01/rdf-schema#Resource>)
          # Get labels for range properties
          OPTIONAL { ?propRange rdfs:label ?propRangeRdfsLabel . FILTER(LANG(?propRangeRdfsLabel) = "en" || LANG(?propRangeRdfsLabel) = "") }
          OPTIONAL { ?propRange skos:prefLabel ?propRangeSkosLabel . FILTER(LANG(?propRangeSkosLabel) = "en" || LANG(?propRangeSkosLabel) = "") }
          OPTIONAL { ?propRange dc:title ?propRangeDcTitle . FILTER(LANG(?propRangeDcTitle) = "en" || LANG(?propRangeDcTitle) = "") }
          BIND(COALESCE(?propRangeRdfsLabel, ?propRangeSkosLabel, ?propRangeDcTitle) AS ?propRangeLabel)
        }
      }
      
      # Find properties that have ANY class in the hierarchy as domain
      OPTIONAL {
        SELECT DISTINCT ?propDomain ?propDomainLabel WHERE {
          <${uri}> rdfs:subClassOf* ?domainClass .
          ?propDomain rdfs:domain ?domainClass .
          #FILTER(?domainClass != <http://www.w3.org/2002/07/owl#Thing> && ?domainClass != <http://www.w3.org/2000/01/rdf-schema#Resource>)
          # Get labels for domain properties
          OPTIONAL { ?propDomain rdfs:label ?propDomainRdfsLabel . FILTER(LANG(?propDomainRdfsLabel) = "en" || LANG(?propDomainRdfsLabel) = "") }
          OPTIONAL { ?propDomain skos:prefLabel ?propDomainSkosLabel . FILTER(LANG(?propDomainSkosLabel) = "en" || LANG(?propDomainSkosLabel) = "") }
          OPTIONAL { ?propDomain dc:title ?propDomainDcTitle . FILTER(LANG(?propDomainDcTitle) = "en" || LANG(?propDomainDcTitle) = "") }
          BIND(COALESCE(?propDomainRdfsLabel, ?propDomainSkosLabel, ?propDomainDcTitle) AS ?propDomainLabel)
        }
      }
    } LIMIT 100000`;

  const bindings = await queryService.executeQuery(query, [sparqlEndpoint]);

  // Process results
  for (const binding of bindings) {
    if (binding.propRange) {
      if (!ranges.has(binding.propRange.value)) {
        ranges.set(
          binding.propRange.value,
          getReadableName(
            binding.propRange.value,
            binding.propRangeLabel?.value
          )
        );
      }
    }
    if (binding.propDomain) {
      if (!domains.has(binding.propDomain.value)) {
        domains.set(
          binding.propDomain.value,
          getReadableName(
            binding.propDomain.value,
            binding.propDomainLabel?.value
          )
        );
      }
    }
    if (binding.classLabel) {
      label = binding.classLabel.value;
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

function formatPropertyInspectionResult(inspection: {
  uri: string;
  label: string;
  description?: string;
  domains: Map<string, string>;
  ranges: Map<string, string>;
  domainHierarchies: Map<string, string>;
  rangeHierarchies: Map<string, string>;
}): string {
  let result = `# Property: ${inspection.label}\nURI: <${inspection.uri}>\n\n`;

  // Add description if available
  if (inspection.description) {
    result += `## Description\n${inspection.description}\n\n`;
  }

  // Add domain information with hierarchy
  if (inspection.domains.size > 0) {
    result += `## Domain Classes (subjects that can use this property)\n`;
    result += `*Note: All classes in the inheritance chain can use this property*\n`;
    for (const [uri, label] of inspection.domains) {
      result += `- <${uri}>: ${label}\n`;
      const hierarchy = inspection.domainHierarchies.get(uri);
      if (hierarchy) {
        result += `  Class hierarchy: ${hierarchy}\n`;
        result += `  (All classes in this chain can use this property)\n`;
      }
      result += `  SPARQL Example: Find '${label}' instances using this property:\n    ?${label.toLowerCase().replace(/\s+/g, '')}Instance a <${uri}> .\n    ?${label.toLowerCase().replace(/\s+/g, '')}Instance <${inspection.uri}> ?value .\n\n`;
    }
    result += "\n";
  }

  // Add range information with hierarchy
  if (inspection.ranges.size > 0) {
    result += `## Range Classes (objects this property can point to)\n`;
    result += `*Note: All classes in the inheritance chain can be values for this property*\n`;
    for (const [uri, label] of inspection.ranges) {
      result += `- <${uri}>: ${label}\n`;
      const hierarchy = inspection.rangeHierarchies.get(uri);
      if (hierarchy) {
        result += `  Class hierarchy: ${hierarchy}\n`;
        result += `  (All classes in this chain can be values for this property)\n`;
      }
      result += `  SPARQL Example: Find entities pointing to '${label}' instances:\n    ?entity <${inspection.uri}> ?${label.toLowerCase().replace(/\s+/g, '')}Instance .\n    ?${label.toLowerCase().replace(/\s+/g, '')}Instance a <${uri}> .\n\n`;
    }
    result += "\n";
  }

  // Add general SPARQL example
  result += `## General SPARQL Usage:\n`;
  result += `?subject <${inspection.uri}> ?object .\n`;
  result += `# This property connects domain class instances to range class instances\n\n`;

  // Add summary
  const domainCount = inspection.domains.size;
  const rangeCount = inspection.ranges.size;
  result += `## Total: ${domainCount} domain${domainCount !== 1 ? "s" : ""
    }, ${rangeCount} range${rangeCount !== 1 ? "s" : ""}\n`;

  return result;
}

function formatOntologyInspectionResult(inspection: {
  ranges: Map<string, string>;
  domains: Map<string, string>;
  label: string;
  description?: string;
  uri: string;
}): string {
  let result = `# Class: ${inspection.label}\nURI: <${inspection.uri}>\n\n`;

  if (inspection.description) {
    result += `## Description\n${inspection.description}\n\n`;
  }

  if (inspection.domains.size > 0) {
    result += `## This class is the DOMAIN of the following properties\n`;
    result += `SPARQL Example: Get values for a '${inspection.label}' instance:\n`;
    result += ` ?${inspection.label.toLowerCase().replace(/\s+/g, '')}Instance a <${inspection.uri}> .\n`;
    result += ` ?${inspection.label.toLowerCase().replace(/\s+/g, '')}Instance <PROPERTY_FROM_LIST_BELOW> ?value .\n\n`;
    for (const [uri, label] of inspection.domains) {
      result += `- <${uri}>: ${label}\n`;
    }
    result += "\n";
  }

  if (inspection.ranges.size > 0) {
    result += `## This class is the RANGE of the following properties\n`;
    result += `SPARQL Example: Find entities that point to a '${inspection.label}'\n`;
    result += ` ?${inspection.label.toLowerCase().replace(/\s+/g, '')}Instance a <${inspection.uri}> .\n`;
    result += ` ?entity <PROPERTY_FROM_LIST_BELOW> ?${inspection.label.toLowerCase().replace(/\s+/g, '')}Instance .\n\n`;
    for (const [uri, label] of inspection.ranges) {
      result += `- <${uri}>: ${label}\n`;
    }
    result += "\n";
  }

  // Add summary
  const domainCount = inspection.domains.size;
  const rangeCount = inspection.ranges.size;
  result += `## Total: ${domainCount} domain properties, ${rangeCount} range properties\n`;

  return result;
}

export async function inspectOntology(
  uri: string,
  sparqlEndpoint: string,
  queryService: QueryService
): Promise<string> {
  // First try to inspect as a class
  const classResult = await inspectClass(uri, sparqlEndpoint, queryService);

  if (classResult.ranges.size > 0 || classResult.domains.size > 0) {
    return formatOntologyInspectionResult(classResult);
  }

  // If not a class, try to inspect as a property
  const propertyResult = await inspectProperty(
    uri,
    sparqlEndpoint,
    queryService
  );

  if (propertyResult) {
    return formatPropertyInspectionResult(propertyResult);
  }

  return `No class or property information found for URI: <${uri}>`;
}

export async function inspect(
  uri: string,
  sparqlEndpoint: string,
  queryService: QueryService
): Promise<string> {
  return await inspectOntology(uri, sparqlEndpoint, queryService);
}