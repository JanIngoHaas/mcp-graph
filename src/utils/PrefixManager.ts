/**
 * Manages URI prefixes for compressed output and automatic query enhancement
 */

interface PrefixMapping {
  [prefix: string]: string;
}

export class PrefixManager {
  private static instance: PrefixManager | null = null;
  private prefixMap: PrefixMapping;

  private constructor() {
    // Built-in common prefixes
    this.prefixMap = {
      'dbo': 'http://dbpedia.org/ontology/',
      'dbr': 'http://dbpedia.org/resource/',
      'dbp': 'http://dbpedia.org/property/',
      'rdfs': 'http://www.w3.org/2000/01/rdf-schema#',
      'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
      'owl': 'http://www.w3.org/2002/07/owl#',
      'xsd': 'http://www.w3.org/2001/XMLSchema#',
      'skos': 'http://www.w3.org/2004/02/skos/core#',
      'foaf': 'http://xmlns.com/foaf/0.1/',
      'dc': 'http://purl.org/dc/elements/1.1/',
      'dct': 'http://purl.org/dc/terms/',
    };

    // Load custom prefixes from environment
    this.loadCustomPrefixes();
  }

  public static getInstance(): PrefixManager {
    if (!PrefixManager.instance) {
      PrefixManager.instance = new PrefixManager();
    }
    return PrefixManager.instance;
  }

  private loadCustomPrefixes(): void {
    const customPrefixes = process.env.CUSTOM_PREFIXES;
    if (!customPrefixes) return;

    try {
      // Parse format: "foaf:<http://xmlns.com/foaf/0.1/>,schema:<http://schema.org/>"
      const pairs = customPrefixes.split(',');
      for (const pair of pairs) {
        const match = pair.trim().match(/^(\w+):<(.+)>$/);
        if (match) {
          const [, prefix, uri] = match;
          this.prefixMap[prefix] = uri;
        }
      }
    } catch (error) {
      console.error('Error parsing CUSTOM_PREFIXES:', error);
    }
  }

  /**
   * Compress a URI using known prefixes
   */
  public compressUri(uri: string): string {
    for (const [prefix, namespace] of Object.entries(this.prefixMap)) {
      if (uri.startsWith(namespace)) {
        return uri.replace(namespace, `${prefix}:`);
      }
    }
    return uri; // Return original if no prefix matches
  }

  /**
   * Expand a prefixed URI back to full URI
   */
  public expandUri(prefixedUri: string): string {
    const colonIndex = prefixedUri.indexOf(':');
    if (colonIndex === -1) return prefixedUri;

    const prefix = prefixedUri.substring(0, colonIndex);
    const localPart = prefixedUri.substring(colonIndex + 1);
    
    const namespace = this.prefixMap[prefix];
    if (namespace) {
      return namespace + localPart;
    }
    
    return prefixedUri; // Return original if prefix not found
  }

  /**
   * Get all PREFIX declarations for SPARQL queries
   */
  public getPrefixDeclarations(): string {
    return Object.entries(this.prefixMap)
      .map(([prefix, uri]) => `PREFIX ${prefix}: <${uri}>`)
      .join('\n');
  }

  /**
   * Add PREFIX declarations to a SPARQL query
   */
  public addPrefixesToQuery(query: string): string {
    const prefixDeclarations = this.getPrefixDeclarations();
    return `${prefixDeclarations}\n\n${query}`;
  }

  /**
   * Get compressed URI for display - model must provide valid URIs
   */
  public getReadableUri(uri: string): string {
    // Try to compress using known prefixes
    const compressed = this.compressUri(uri);
    if (compressed !== uri) {
      return compressed;
    }
    
    // If no prefix matches, return the URI as-is
    // The model needs to work with actual URIs, not invented labels
    return uri;
  }

  /**
   * Compress all URIs in text and prepend prefix declarations for used prefixes
   */
  public compressTextWithPrefixes(text: string): string {
    let result = text;
    const usedPrefixes = new Set<string>();
    
    // Replace all instances of namespace URIs with prefixes
    for (const [prefix, namespace] of Object.entries(this.prefixMap)) {
      if (result.includes(namespace)) {
        // Escape regex special characters in namespace URI and replace globally
        // e.g., "http://dbpedia.org/ontology/" becomes "http:\/\/dbpedia\.org\/ontology\/"
        const escapedNamespace = namespace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(escapedNamespace, 'g'), `${prefix}:`);
        usedPrefixes.add(prefix);
      }
    }
    
    // Generate prefix declarations only for used prefixes
    if (usedPrefixes.size === 0) {
      return result; // No prefixes used, return as-is
    }
    
    const prefixDeclarations = Array.from(usedPrefixes)
      .sort() // Sort for consistent output
      .map(prefix => `PREFIX ${prefix}: <${this.prefixMap[prefix]}>`)
      .join('\n');
      
    return `${prefixDeclarations}\n\n${result}`;
  }

  /**
   * Get all registered prefixes (for debugging)
   */
  public getAllPrefixes(): PrefixMapping {
    return { ...this.prefixMap };
  }
}