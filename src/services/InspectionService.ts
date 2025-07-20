import { QueryService } from './QueryService';
import { PropertyMapByPosition, LabelledNode } from '../types';
import { getReadableName } from '../utils.js';

export class InspectionService {
  private queryService: QueryService;
  private typeCache = new Map<string, boolean>();

  constructor(queryService: QueryService) {
    this.queryService = queryService;
  }

  private getDisplayName(node: LabelledNode): string {
    return node.label || getReadableName(node.uri);
  }

  private buildLabelQuery(): string {
    return `
      OPTIONAL { ?target rdfs:label ?rdfsLabel . FILTER(LANG(?rdfsLabel) = "en" || LANG(?rdfsLabel) = "") }
      OPTIONAL { ?target skos:prefLabel ?skosLabel . FILTER(LANG(?skosLabel) = "en" || LANG(?skosLabel) = "") }
      OPTIONAL { ?target dc:title ?dcTitle . FILTER(LANG(?dcTitle) = "en" || LANG(?dcTitle) = "") }
      BIND(COALESCE(?rdfsLabel, ?skosLabel, ?dcTitle) AS ?targetLabel)`;
  }

  private buildCommonFilters(): string {
    return `
      FILTER(!CONTAINS(STR(?property), "http://www.w3.org/2002/07/owl#"))
      FILTER(!CONTAINS(STR(?property), "http://www.openlinksw.com/schemas/"))
      FILTER(?property != rdf:type)`;
  }

  private formatMetadataResponse(uri: string, property: string, value: LabelledNode, isSubject: boolean): string {
    let response = `### Schema Definition\n`;
    response += `Inspected URI is part of the metadata/ontology structure.\n`;
    
    if (property === 'http://www.w3.org/2000/01/rdf-schema#domain') {
      if (isSubject) {
        response += `**Domain:** ${this.getDisplayName(value)}\n`;
        response += `**Property:** ${getReadableName(uri)} (${getReadableName(uri)}) [inspected URI]\n`;
        response += `**Range:** See other entries in this inspection\n`;
      } else {
        response += `**Domain:** ${getReadableName(uri)} (${getReadableName(uri)}) [inspected URI]\n`;
        response += `**Property:** ${this.getDisplayName(value)}\n`;
        response += `**Range:** Missing - inspect property ${this.getDisplayName(value)} to find range\n`;
      }
    } else if (property === 'http://www.w3.org/2000/01/rdf-schema#range') {
      if (isSubject) {
        response += `**Domain:** See other entries in this inspection\n`;
        response += `**Property:** ${getReadableName(uri)} (${getReadableName(uri)}) [inspected URI]\n`;
        response += `**Range:** ${this.getDisplayName(value)}\n`;
      } else {
        response += `**Domain:** Missing - inspect property ${this.getDisplayName(value)} to find domain\n`;
        response += `**Property:** ${this.getDisplayName(value)}\n`;
        response += `**Range:** ${getReadableName(uri)} (${getReadableName(uri)}) [inspected URI]\n`;
      }
    } else {
      if (isSubject) {
        response += `**Domain:** ${getReadableName(uri)} (${getReadableName(uri)}) [inspected URI]\n`;
        response += `**Property:** ${getReadableName(property)} (${getReadableName(property)})\n`;
        response += `**Range:** ${this.getDisplayName(value)}\n`;
      } else {
        response += `**Domain:** ${this.getDisplayName(value)}\n`;
        response += `**Property:** ${getReadableName(property)} (${getReadableName(property)})\n`;
        response += `**Range:** ${getReadableName(uri)} (${getReadableName(uri)}) [inspected URI]\n`;
      }
    }
    
    response += `**SPARQL Example:** \`?${isSubject ? 'instance' : 'subject'} <${property}> ${isSubject ? '?value' : `<${uri}>`} .${isSubject ? ` ?instance a <${uri}> .` : ''}\`\n\n`;
    return response;
  }

  private formatInstanceResponse(uri: string, property: string, value: LabelledNode, isSubject: boolean): string {
    let response = `### Instance Data\n`;
    response += `Inspected URI represents actual data in the knowledge graph.\n`;
    
    if (isSubject) {
      response += `**Domain:** ${getReadableName(uri)} (${getReadableName(uri)}) [inspected URI] → **Property:** ${getReadableName(property)} (${getReadableName(property)}) → **Range:** ${this.getDisplayName(value)}\n\n`;
    } else {
      response += `**Domain:** ${this.getDisplayName(value)} → **Property:** ${getReadableName(property)} (${getReadableName(property)}) → **Range:** ${getReadableName(uri)} (${getReadableName(uri)}) [inspected URI]\n\n`;
    }
    
    return response;
  }


  private async isMetadata(uri: string, position: string, sparqlEndpoint: string): Promise<boolean> {

    // We deal with metadata if uri is a property and it's not in it's 'usual' predicate position.
    // For example:
    /*
    if we take dbo:starring:
    A dbo:starring B . <-- This is instance data, as dbo:starring is a property and it's in "predicate" position (usual)

    if we take dbo:starring again:
    dbo:starring rdfs:domain dbo:Film . <-- This is metadata, as dbo:starring is a property and it's in "subject" position.

    So, if we have statements about properties, we deal with metadata.
    */

    let isProperty: boolean;
    if (this.typeCache.has(uri)) {
      isProperty = this.typeCache.get(uri)!;
    }
    else {
      const typeQuery = `      
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        SELECT DISTINCT ?type WHERE {
          <${uri}> a ?type .
        }`;

      let bindings = await this.queryService.executeQuery(typeQuery, [sparqlEndpoint]);

      const metadataTypes = new Set([
        'http://www.w3.org/1999/02/22-rdf-syntax-ns#Property',
        'http://www.w3.org/2002/07/owl#ObjectProperty',
        'http://www.w3.org/2002/07/owl#DatatypeProperty',
        'http://www.w3.org/2002/07/owl#FunctionalProperty',
        'http://www.w3.org/2002/07/owl#InverseFunctionalProperty',
      ]);

      isProperty = bindings.some(binding => metadataTypes.has(binding.type.value));
      this.typeCache.set(uri, isProperty);
    }

    if (isProperty) {
      if (position === 'subject' || position === 'object') {
        return true;
      }
    }
    return false;
  }

  private mergeProperties(from: Map<string, LabelledNode[]>, to: Map<string, LabelledNode[]>): void {
    for (const [property, values] of from) {
      if (!to.has(property)) {
        to.set(property, []);
      }
      to.get(property)!.push(...values);
    }
  }

  private processResults(results: any[], directPropertiesMap: PropertyMapByPosition, position: 'subject' | 'object' | 'predicate'): void {
    for (const result of results) {
      if (position === 'predicate') {
        if (!result.subject || !result.object) continue;

        const subject: LabelledNode = {
          uri: result.subject.value,
          label: result.subjectLabel?.value
        };
        const object: LabelledNode = {
          uri: result.object.value,
          label: result.objectLabel?.value
        };

        directPropertiesMap.predicate.push({ subject, object });
      } else {
        if (!result.property || !result.value) continue;

        const property = result.property.value;
        const valueNode: LabelledNode = {
          uri: result.value.value,
          label: result.valueLabel?.value
        };

        if (position === 'subject') {
          if (!directPropertiesMap.subject.has(property)) {
            directPropertiesMap.subject.set(property, []);
          }
          directPropertiesMap.subject.get(property)!.push(valueNode);
        } else {
          if (!directPropertiesMap.object.has(property)) {
            directPropertiesMap.object.set(property, []);
          }
          directPropertiesMap.object.get(property)!.push(valueNode);
        }
      }
    }
  }

  private async getDirectProperties(uri: string, sparqlEndpoint: string): Promise<PropertyMapByPosition> {
    const directPropertiesMap: PropertyMapByPosition = {
      subject: new Map(),
      object: new Map(),
      predicate: []
    };

    // Subject Query (where URI is subject)
    const subjectQuery = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
      PREFIX dc: <http://purl.org/dc/elements/1.1/>
      PREFIX dbo: <http://dbpedia.org/ontology/>
      SELECT DISTINCT ?property ?value ?valueLabel WHERE {
        <${uri}> ?property ?value .
        ${this.buildLabelQuery().replace('?target', '?value')}
        ${this.buildCommonFilters()}
        FILTER(IF(LANG(?value) != "", LANG(?value) = "en", true))
      }
      ORDER BY ?property ?value
    `;

    // Object Query (where URI is object)
    const objectQuery = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
      PREFIX dc: <http://purl.org/dc/elements/1.1/>
      PREFIX dbo: <http://dbpedia.org/ontology/>
      SELECT DISTINCT ?property ?value ?valueLabel WHERE {
        ?value ?property <${uri}> .
        ${this.buildLabelQuery().replace('?target', '?value')}
        ${this.buildCommonFilters()}
      }
      ORDER BY ?property ?value
    `;

    // Predicate Query (where URI is predicate)
    const predicateQuery = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
      PREFIX dc: <http://purl.org/dc/elements/1.1/>
      PREFIX dbo: <http://dbpedia.org/ontology/>
      SELECT DISTINCT ?subject ?object ?subjectLabel ?objectLabel WHERE {
        ?subject <${uri}> ?object .
        ${this.buildLabelQuery().replace('?target', '?subject').replace('?targetLabel', '?subjectLabel')}
        ${this.buildLabelQuery().replace('?target', '?object').replace('?targetLabel', '?objectLabel')}
        FILTER(IF(LANG(?object) != "", LANG(?object) = "en", true))
      }
      ORDER BY ?subject ?object
    `;

    try {
      // Execute all three queries for direct properties
      const subjectResults = await this.queryService.executeQuery(subjectQuery, [sparqlEndpoint]);
      const objectResults = await this.queryService.executeQuery(objectQuery, [sparqlEndpoint]);
      const predicateResults = await this.queryService.executeQuery(predicateQuery, [sparqlEndpoint]);

      this.processResults(subjectResults, directPropertiesMap, 'subject');
      this.processResults(objectResults, directPropertiesMap, 'object');
      this.processResults(predicateResults, directPropertiesMap, 'predicate');

      return directPropertiesMap;
    } catch (error) {
      throw error;
    }
  }

  private async getParentURIs(uri: string, sparqlEndpoint: string): Promise<string[]> {
    const parentQuery = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX owl: <http://www.w3.org/2002/07/owl#>
      SELECT DISTINCT ?parent WHERE {
        <${uri}> ?p ?parent .
        FILTER(?p IN (rdfs:subClassOf, rdfs:subPropertyOf))        
          
        FILTER(?parent != <http://www.w3.org/2002/07/owl#Thing>)
        FILTER(?parent != <http://www.w3.org/2000/01/rdf-schema#Resource>)
        FILTER(?parent != <http://www.w3.org/2000/01/rdf-schema#Class>)
        FILTER(?parent != <http://www.w3.org/1999/02/22-rdf-syntax-ns#Property>)
        FILTER(!CONTAINS(STR(?parent), "http://www.openlinksw.com/schemas/"))
      }
    `;

    try {
      const results = await this.queryService.executeQuery(parentQuery, [sparqlEndpoint]);
      return results
        .filter(result => result.parent)
        .map(result => result.parent.value);
    } catch (error) {
      console.error('Error getting parent URIs:', error);
      return [];
    }
  }

  private async inspectInner(uri: string, sparqlEndpoint: string): Promise<PropertyMapByPosition> {
    const directProperties = await this.getDirectProperties(uri, sparqlEndpoint);
    let allPropertiesMap: PropertyMapByPosition = directProperties;

    // Recursively collect properties from parent URIs
    const parentURIs = await this.getParentURIs(uri, sparqlEndpoint);
    for (const parentURI of parentURIs) {
      const parentProperties = await this.inspectInner(parentURI, sparqlEndpoint);

      // Merge parent subject and object properties
      this.mergeProperties(parentProperties.subject, allPropertiesMap.subject);
      this.mergeProperties(parentProperties.object, allPropertiesMap.object);

      // Merge parent predicate properties
      allPropertiesMap.predicate.push(...parentProperties.predicate);
    }
    return allPropertiesMap;
  }

  public async inspect(uri: string, sparqlEndpoint: string): Promise<string> {
    if (!sparqlEndpoint) {
      throw new Error('SPARQL endpoint not configured');
    }

    // Get all properties (direct and inherited) using recursive traversal
    const allPropertiesMap = await this.inspectInner(uri, sparqlEndpoint);

    // Format the output based on resource type
    let response: string;

    response = `# Inspected URI: ${getReadableName(uri)}\n\n`;

    if (allPropertiesMap.subject.size === 0 && allPropertiesMap.object.size === 0 && allPropertiesMap.predicate.length === 0) {
      response += 'No properties found for this resource.';
      return response;
    }

    // Render statements where inspected URI is the subject
    if (allPropertiesMap.subject.size > 0) {
      response += `## Statements where this inspected URI is the SUBJECT:\n`;
      
      for (const [property, values] of allPropertiesMap.subject) {
        for (const value of values) {
          const isMetadata = await this.isMetadata(uri, 'subject', sparqlEndpoint) || await this.isMetadata(value.uri, 'object', sparqlEndpoint);
          
          if (isMetadata) {
            response += this.formatMetadataResponse(uri, property, value, true);
          } else {
            response += this.formatInstanceResponse(uri, property, value, true);
          }
        }
      }
    }

    // Render statements where inspected URI is the object
    if (allPropertiesMap.object.size > 0) {
      response += `## Statements where this inspected URI is the OBJECT:\n`;
      
      for (const [property, subjects] of allPropertiesMap.object) {
        for (const subject of subjects) {
          const isMetadata = await this.isMetadata(subject.uri, 'subject', sparqlEndpoint) || await this.isMetadata(uri, 'object', sparqlEndpoint);
          
          if (isMetadata) {
            response += this.formatMetadataResponse(uri, property, subject, false);
          } else {
            response += this.formatInstanceResponse(uri, property, subject, false);
          }
        }
      }
    }

    // Render statements where inspected URI is the predicate
    if (allPropertiesMap.predicate.length > 0) {
      response += `## Statements where this inspected URI is the PREDICATE:\n`;
      
      for (const connection of allPropertiesMap.predicate) {
        response += `### Property Usage\n`;
        response += `Inspected URI is being used as a property/relationship.\n`;
        response += `**Domain:** ${this.getDisplayName(connection.subject)}\n`;
        response += `**Property:** ${getReadableName(uri)} (${getReadableName(uri)}) [inspected URI]\n`;
        response += `**Range:** ${this.getDisplayName(connection.object)}\n`;
        response += `**SPARQL Example:** \`SELECT * WHERE { ?subject <${uri}> ?object }\`\n\n`;
      }
    }

    return response;
  }
}