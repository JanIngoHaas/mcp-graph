import { getDisplayName } from "@modelcontextprotocol/sdk/shared/metadataUtils.js";
import { getReadableName } from "../utils.js";
import { QueryService } from "./QueryService";

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

        ?propURI rdfs:range ?propRange .
        ?propURI rdfs:domain ?propDomain .

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

  // Check if we have any domain or range info (property must have at least one)
  if (propRange.size === 0 && propDomain.size === 0) {
    return null; // No domain/range found, likely not a property
  }

  return {
    ranges: propRange,
    domains: propDomain,
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
        ?propRange rdfs:range ?rangeClass .
        {
          SELECT ?rangeClass WHERE {
            ?classURI rdfs:subClassOf+ ?rangeClass .
            FILTER(?rangeClass != <http://www.w3.org/2002/07/owl#Thing> && ?rangeClass != <http://www.w3.org/2000/01/rdf-schema#Resource>)
          }
        }
        # Get labels for range properties
        OPTIONAL { ?propRange rdfs:label ?propRangeRdfsLabel . FILTER(LANG(?propRangeRdfsLabel) = "en" || LANG(?propRangeRdfsLabel) = "") }
        OPTIONAL { ?propRange skos:prefLabel ?propRangeSkosLabel . FILTER(LANG(?propRangeSkosLabel) = "en" || LANG(?propRangeSkosLabel) = "") }
        OPTIONAL { ?propRange dc:title ?propRangeDcTitle . FILTER(LANG(?propRangeDcTitle) = "en" || LANG(?propRangeDcTitle) = "") }
        BIND(COALESCE(?propRangeRdfsLabel, ?propRangeSkosLabel, ?propRangeDcTitle) AS ?propRangeLabel)
      }
      
      # Find properties that have ANY class in the hierarchy as domain
      OPTIONAL { 
        ?propDomain rdfs:domain ?domainClass .
        {
          SELECT ?domainClass WHERE {
            ?classURI rdfs:subClassOf+ ?domainClass .
            FILTER(?domainClass != <http://www.w3.org/2002/07/owl#Thing> && ?domainClass != <http://www.w3.org/2000/01/rdf-schema#Resource>)
          }
        }
        # Get labels for domain properties
        OPTIONAL { ?propDomain rdfs:label ?propDomainRdfsLabel . FILTER(LANG(?propDomainRdfsLabel) = "en" || LANG(?propDomainRdfsLabel) = "") }
        OPTIONAL { ?propDomain skos:prefLabel ?propDomainSkosLabel . FILTER(LANG(?propDomainSkosLabel) = "en" || LANG(?propDomainSkosLabel) = "") }
        OPTIONAL { ?propDomain dc:title ?propDomainDcTitle . FILTER(LANG(?propDomainDcTitle) = "en" || LANG(?propDomainDcTitle) = "") }
        BIND(COALESCE(?propDomainRdfsLabel, ?propDomainSkosLabel, ?propDomainDcTitle) AS ?propDomainLabel)
      }
    }`;

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
}): string {
  let result = `# Property: ${inspection.label}\nURI: <${inspection.uri}>\n\n`;

  // Add description if available
  if (inspection.description) {
    result += `## Description\n${inspection.description}\n\n`;
  }

  // Add domain-range relationship (cartesian product - any domain can connect to any range)
  result += `## Domain-Range Relationships (Cartesian Product):\n`;

  if (inspection.domains.size > 0) {
    const domainList = Array.from(inspection.domains.entries())
      .map(([uri, label]) => `${label} (<${uri}>)`)
      .join(", ");
    result += `Domains: ${domainList}\n`;
  } else {
    result += `Domains: Not specified\n`;
  }

  if (inspection.ranges.size > 0) {
    const rangeList = Array.from(inspection.ranges.entries())
      .map(([uri, label]) => `${label} (<${uri}>)`)
      .join(", ");
    result += `Ranges: ${rangeList}\n`;
  } else {
    result += `Ranges: Not specified\n`;
  }

  result += `Property: ${inspection.label} (<${inspection.uri}>)\n\n`;

  // Add SPARQL example
  result += `## SPARQL Usage Example:\n`;
  result += `?subject <${inspection.uri}> ?object .\n\n`;

  // Add summary
  const domainCount = inspection.domains.size;
  const rangeCount = inspection.ranges.size;
  result += `## Total: ${domainCount} domain${
    domainCount !== 1 ? "s" : ""
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

  // Add description if available
  if (inspection.description) {
    result += `## Description\n${inspection.description}\n\n`;
  }

  // Add domain properties (what this class can have)
  if (inspection.domains.size > 0) {
    result += `## Properties with this class as DOMAIN (what a ${inspection.label} can have):\n`;
    for (const [uri, label] of inspection.domains) {
      result += `- ${label} (<${uri}>)\n`;
    }
    result += "\n";
  }

  // Add range properties (what points to this class)
  if (inspection.ranges.size > 0) {
    result += `## Properties with this class as RANGE (what points to ${inspection.label}):\n`;
    for (const [uri, label] of inspection.ranges) {
      result += `- ${label} (<${uri}>)\n`;
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

// import { QueryService } from './QueryService';
// import { PropertyMapByPosition, LabelledNode } from '../types';
// import { getReadableName } from '../utils.js';

// export class InspectionService {
//   private queryService: QueryService;
//   private typeCache = new Map<string, boolean>();

//   constructor(queryService: QueryService) {
//     this.queryService = queryService;
//   }

//   private getDisplayName(node: LabelledNode): string {
//     return node.label || getReadableName(node.uri);
//   }

//   private buildLabelQuery(): string {
//     return `
//       OPTIONAL { ?target rdfs:label ?rdfsLabel . FILTER(LANG(?rdfsLabel) = "en" || LANG(?rdfsLabel) = "") }
//       OPTIONAL { ?target skos:prefLabel ?skosLabel . FILTER(LANG(?skosLabel) = "en" || LANG(?skosLabel) = "") }
//       OPTIONAL { ?target dc:title ?dcTitle . FILTER(LANG(?dcTitle) = "en" || LANG(?dcTitle) = "") }
//       BIND(COALESCE(?rdfsLabel, ?skosLabel, ?dcTitle) AS ?targetLabel)`;
//   }

//   private buildCommonFilters(): string {
//     return `
//       FILTER(!CONTAINS(STR(?property), "http://www.w3.org/2002/07/owl#"))
//       FILTER(!CONTAINS(STR(?property), "http://www.openlinksw.com/schemas/"))
//       FILTER(?property != rdf:type)`;
//   }

//   private formatMetadataResponse(uri: string, property: string, value: LabelledNode, isSubject: boolean): string {
//     let response = `### Schema Definition\n`;
//     response += `Inspected URI is part of the metadata/ontology structure.\n`;

//     if (property === 'http://www.w3.org/2000/01/rdf-schema#domain') {
//       if (isSubject) {
//         response += `**Domain:** ${this.getDisplayName(value)}\n`;
//         response += `**Property:** ${getReadableName(uri)} (${getReadableName(uri)}) [inspected URI]\n`;
//         response += `**Range:** See other entries in this inspection\n`;
//       } else {
//         response += `**Domain:** ${getReadableName(uri)} (${getReadableName(uri)}) [inspected URI]\n`;
//         response += `**Property:** ${this.getDisplayName(value)}\n`;
//         response += `**Range:** Missing - inspect property ${this.getDisplayName(value)} to find range\n`;
//       }
//     } else if (property === 'http://www.w3.org/2000/01/rdf-schema#range') {
//       if (isSubject) {
//         response += `**Domain:** See other entries in this inspection\n`;
//         response += `**Property:** ${getReadableName(uri)} (${getReadableName(uri)}) [inspected URI]\n`;
//         response += `**Range:** ${this.getDisplayName(value)}\n`;
//       } else {
//         response += `**Domain:** Missing - inspect property ${this.getDisplayName(value)} to find domain\n`;
//         response += `**Property:** ${this.getDisplayName(value)}\n`;
//         response += `**Range:** ${getReadableName(uri)} (${getReadableName(uri)}) [inspected URI]\n`;
//       }
//     } else {
//       if (isSubject) {
//         response += `**Domain:** ${getReadableName(uri)} (${getReadableName(uri)}) [inspected URI]\n`;
//         response += `**Property:** ${getReadableName(property)} (${getReadableName(property)})\n`;
//         response += `**Range:** ${this.getDisplayName(value)}\n`;
//       } else {
//         response += `**Domain:** ${this.getDisplayName(value)}\n`;
//         response += `**Property:** ${getReadableName(property)} (${getReadableName(property)})\n`;
//         response += `**Range:** ${getReadableName(uri)} (${getReadableName(uri)}) [inspected URI]\n`;
//       }
//     }

//     response += `**SPARQL Example:** \`?${isSubject ? 'instance' : 'subject'} <${property}> ${isSubject ? '?value' : `<${uri}>`} .${isSubject ? ` ?instance a <${uri}> .` : ''}\`\n\n`;
//     return response;
//   }

//   private formatInstanceResponse(uri: string, property: string, value: LabelledNode, isSubject: boolean): string {
//     let response = `### Instance Data\n`;
//     response += `Inspected URI represents actual data in the knowledge graph.\n`;

//     if (isSubject) {
//       response += `**Domain:** ${getReadableName(uri)} (${getReadableName(uri)}) [inspected URI] → **Property:** ${getReadableName(property)} (${getReadableName(property)}) → **Range:** ${this.getDisplayName(value)}\n\n`;
//     } else {
//       response += `**Domain:** ${this.getDisplayName(value)} → **Property:** ${getReadableName(property)} (${getReadableName(property)}) → **Range:** ${getReadableName(uri)} (${getReadableName(uri)}) [inspected URI]\n\n`;
//     }

//     return response;
//   }

//   private async isMetadata(uri: string, position: string, sparqlEndpoint: string): Promise<boolean> {

//     // We deal with metadata if uri is a property and it's not in it's 'usual' predicate position.
//     // For example:
//     /*
//     if we take dbo:starring:
//     A dbo:starring B . <-- This is instance data, as dbo:starring is a property and it's in "predicate" position (usual)

//     if we take dbo:starring again:
//     dbo:starring rdfs:domain dbo:Film . <-- This is metadata, as dbo:starring is a property and it's in "subject" position.

//     So, if we have statements about properties, we deal with metadata.
//     */

//     let isProperty: boolean;
//     if (this.typeCache.has(uri)) {
//       isProperty = this.typeCache.get(uri)!;
//     }
//     else {
//       const typeQuery = `
//         PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
//         PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
//         SELECT DISTINCT ?type WHERE {
//           <${uri}> a ?type .
//         }`;

//       let bindings = await this.queryService.executeQuery(typeQuery, [sparqlEndpoint]);

//       const metadataTypes = new Set([
//         'http://www.w3.org/1999/02/22-rdf-syntax-ns#Property',
//         'http://www.w3.org/2002/07/owl#ObjectProperty',
//         'http://www.w3.org/2002/07/owl#DatatypeProperty',
//         'http://www.w3.org/2002/07/owl#FunctionalProperty',
//         'http://www.w3.org/2002/07/owl#InverseFunctionalProperty',
//       ]);

//       isProperty = bindings.some(binding => metadataTypes.has(binding.type.value));
//       this.typeCache.set(uri, isProperty);
//     }

//     if (isProperty) {
//       if (position === 'subject' || position === 'object') {
//         return true;
//       }
//     }
//     return false;
//   }

//   private mergeProperties(from: Map<string, LabelledNode[]>, to: Map<string, LabelledNode[]>): void {
//     for (const [property, values] of from) {
//       if (!to.has(property)) {
//         to.set(property, []);
//       }
//       to.get(property)!.push(...values);
//     }
//   }

//   private processResults(results: any[], directPropertiesMap: PropertyMapByPosition, position: 'subject' | 'object' | 'predicate'): void {
//     for (const result of results) {
//       if (position === 'predicate') {
//         if (!result.subject || !result.object) continue;

//         const subject: LabelledNode = {
//           uri: result.subject.value,
//           label: result.subjectLabel?.value
//         };
//         const object: LabelledNode = {
//           uri: result.object.value,
//           label: result.objectLabel?.value
//         };

//         directPropertiesMap.predicate.push({ subject, object });
//       } else {
//         if (!result.property || !result.value) continue;

//         const property = result.property.value;
//         const valueNode: LabelledNode = {
//           uri: result.value.value,
//           label: result.valueLabel?.value
//         };

//         if (position === 'subject') {
//           if (!directPropertiesMap.subject.has(property)) {
//             directPropertiesMap.subject.set(property, []);
//           }
//           directPropertiesMap.subject.get(property)!.push(valueNode);
//         } else {
//           if (!directPropertiesMap.object.has(property)) {
//             directPropertiesMap.object.set(property, []);
//           }
//           directPropertiesMap.object.get(property)!.push(valueNode);
//         }
//       }
//     }
//   }

//   private async getDirectProperties(uri: string, sparqlEndpoint: string): Promise<PropertyMapByPosition> {
//     const directPropertiesMap: PropertyMapByPosition = {
//       subject: new Map(),
//       object: new Map(),
//       predicate: []
//     };

//     // Subject Query (where URI is subject)
//     const subjectQuery = `
//       PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
//       PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
//       PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
//       PREFIX dc: <http://purl.org/dc/elements/1.1/>
//       PREFIX dbo: <http://dbpedia.org/ontology/>
//       SELECT DISTINCT ?property ?value ?valueLabel WHERE {
//         <${uri}> ?property ?value .
//         ${this.buildLabelQuery().replace('?target', '?value')}
//         ${this.buildCommonFilters()}
//         FILTER(IF(LANG(?value) != "", LANG(?value) = "en", true))
//       }
//       ORDER BY ?property ?value
//     `;

//     // Object Query (where URI is object)
//     const objectQuery = `
//       PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
//       PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
//       PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
//       PREFIX dc: <http://purl.org/dc/elements/1.1/>
//       PREFIX dbo: <http://dbpedia.org/ontology/>
//       SELECT DISTINCT ?property ?value ?valueLabel WHERE {
//         ?value ?property <${uri}> .
//         ${this.buildLabelQuery().replace('?target', '?value')}
//         ${this.buildCommonFilters()}
//       }
//       ORDER BY ?property ?value
//     `;

//     // Predicate Query (where URI is predicate)
//     const predicateQuery = `
//       PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
//       PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
//       PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
//       PREFIX dc: <http://purl.org/dc/elements/1.1/>
//       PREFIX dbo: <http://dbpedia.org/ontology/>
//       SELECT DISTINCT ?subject ?object ?subjectLabel ?objectLabel WHERE {
//         ?subject <${uri}> ?object .
//         ${this.buildLabelQuery().replace('?target', '?subject').replace('?targetLabel', '?subjectLabel')}
//         ${this.buildLabelQuery().replace('?target', '?object').replace('?targetLabel', '?objectLabel')}
//         FILTER(IF(LANG(?object) != "", LANG(?object) = "en", true))
//       }
//       ORDER BY ?subject ?object
//     `;

//     try {
//       // Execute all three queries for direct properties
//       const subjectResults = await this.queryService.executeQuery(subjectQuery, [sparqlEndpoint]);
//       const objectResults = await this.queryService.executeQuery(objectQuery, [sparqlEndpoint]);
//       const predicateResults = await this.queryService.executeQuery(predicateQuery, [sparqlEndpoint]);

//       this.processResults(subjectResults, directPropertiesMap, 'subject');
//       this.processResults(objectResults, directPropertiesMap, 'object');
//       this.processResults(predicateResults, directPropertiesMap, 'predicate');

//       return directPropertiesMap;
//     } catch (error) {
//       throw error;
//     }
//   }

//   private async getParentURIs(uri: string, sparqlEndpoint: string): Promise<string[]> {
//     const parentQuery = `
//       PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
//       PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
//       PREFIX owl: <http://www.w3.org/2002/07/owl#>
//       SELECT DISTINCT ?parent WHERE {
//         <${uri}> ?p ?parent .
//         FILTER(?p IN (rdfs:subClassOf, rdfs:subPropertyOf))

//         FILTER(?parent != <http://www.w3.org/2002/07/owl#Thing>)
//         FILTER(?parent != <http://www.w3.org/2000/01/rdf-schema#Resource>)
//         FILTER(?parent != <http://www.w3.org/2000/01/rdf-schema#Class>)
//         FILTER(?parent != <http://www.w3.org/1999/02/22-rdf-syntax-ns#Property>)
//         FILTER(!CONTAINS(STR(?parent), "http://www.openlinksw.com/schemas/"))
//       }
//     `;

//     try {
//       const results = await this.queryService.executeQuery(parentQuery, [sparqlEndpoint]);
//       return results
//         .filter(result => result.parent)
//         .map(result => result.parent.value);
//     } catch (error) {
//       console.error('Error getting parent URIs:', error);
//       return [];
//     }
//   }

//   private async inspectInner(uri: string, sparqlEndpoint: string): Promise<PropertyMapByPosition> {
//     const directProperties = await this.getDirectProperties(uri, sparqlEndpoint);
//     let allPropertiesMap: PropertyMapByPosition = directProperties;

//     // Recursively collect properties from parent URIs
//     const parentURIs = await this.getParentURIs(uri, sparqlEndpoint);
//     for (const parentURI of parentURIs) {
//       const parentProperties = await this.inspectInner(parentURI, sparqlEndpoint);

//       // Merge parent subject and object properties
//       this.mergeProperties(parentProperties.subject, allPropertiesMap.subject);
//       this.mergeProperties(parentProperties.object, allPropertiesMap.object);

//       // Merge parent predicate properties
//       allPropertiesMap.predicate.push(...parentProperties.predicate);
//     }
//     return allPropertiesMap;
//   }

//   public async inspect(uri: string, sparqlEndpoint: string): Promise<string> {
//     if (!sparqlEndpoint) {
//       throw new Error('SPARQL endpoint not configured');
//     }

//     // Get all properties (direct and inherited) using recursive traversal
//     const allPropertiesMap = await this.inspectInner(uri, sparqlEndpoint);

//     // Format the output based on resource type
//     let response: string;

//     response = `# Inspected URI: ${getReadableName(uri)}\n\n`;

//     if (allPropertiesMap.subject.size === 0 && allPropertiesMap.object.size === 0 && allPropertiesMap.predicate.length === 0) {
//       response += 'No properties found for this resource.';
//       return response;
//     }

//     // Render statements where inspected URI is the subject
//     if (allPropertiesMap.subject.size > 0) {
//       response += `## Statements where this inspected URI is the SUBJECT:\n`;

//       for (const [property, values] of allPropertiesMap.subject) {
//         for (const value of values) {
//           const isMetadata = await this.isMetadata(uri, 'subject', sparqlEndpoint) || await this.isMetadata(value.uri, 'object', sparqlEndpoint);

//           if (isMetadata) {
//             response += this.formatMetadataResponse(uri, property, value, true);
//           } else {
//             response += this.formatInstanceResponse(uri, property, value, true);
//           }
//         }
//       }
//     }

//     // Render statements where inspected URI is the object
//     if (allPropertiesMap.object.size > 0) {
//       response += `## Statements where this inspected URI is the OBJECT:\n`;

//       for (const [property, subjects] of allPropertiesMap.object) {
//         for (const subject of subjects) {
//           const isMetadata = await this.isMetadata(subject.uri, 'subject', sparqlEndpoint) || await this.isMetadata(uri, 'object', sparqlEndpoint);

//           if (isMetadata) {
//             response += this.formatMetadataResponse(uri, property, subject, false);
//           } else {
//             response += this.formatInstanceResponse(uri, property, subject, false);
//           }
//         }
//       }
//     }

//     // Render statements where inspected URI is the predicate
//     if (allPropertiesMap.predicate.length > 0) {
//       response += `## Statements where this inspected URI is the PREDICATE:\n`;

//       for (const connection of allPropertiesMap.predicate) {
//         response += `### Property Usage\n`;
//         response += `Inspected URI is being used as a property/relationship.\n`;
//         response += `**Domain:** ${this.getDisplayName(connection.subject)}\n`;
//         response += `**Property:** ${getReadableName(uri)} (${getReadableName(uri)}) [inspected URI]\n`;
//         response += `**Range:** ${this.getDisplayName(connection.object)}\n`;
//         response += `**SPARQL Example:** \`SELECT * WHERE { ?subject <${uri}> ?object }\`\n\n`;
//       }
//     }

//     return response;
//   }
// }
