import { QueryEngine } from '@comunica/query-sparql';
import { QueryStringContext } from '@comunica/types';
import { Store, DataFactory, Quad } from 'n3';
import { FeatureExtractionPipeline, pipeline } from "@huggingface/transformers";
import * as sqliteVec from "sqlite-vec";
import Database from "better-sqlite3";
import fs from 'fs';
import path from 'path';

const RDFS_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

const { namedNode, literal, quad } = DataFactory;

export interface TypeInfo {
  typeUri: string;
  label?: string;
  description?: string;
}

export interface PropertyInfo {
  propertyUri: string;
  label?: string;
  description?: string;
  domainRangePairs: Map<string, { domain: TypeInfo, range: TypeInfo }>;
}

export interface ExplorationOptions {
  includeLabels?: boolean;
  includeDescriptions?: boolean;
  batchSize?: number;
  onProgress?: (processed: number, total?: number) => void;
  llmBasedExampleQuery?: boolean;
}

export interface ResourceResult {
  uri: string;
  label?: string;
  description?: string;
  type?: string;
}

export interface OntologyInfo {
  ontologyUri: string;
  ontologyType: "metadata" | "probably data";
}

export interface PropertyEntry {
  value: { subject: string, predicate: string, object: string };
  position: 'subject' | 'object' | 'predicate';
}

export type PropertyMap = Map<string, Array<PropertyEntry>>;

export class ExplorationService {
  private queryEngine: QueryEngine;
  private _embedder: FeatureExtractionPipeline | null;
  private _db: Database.Database | null;
  private _dbPath: string;
  private _sparqlEndpoint: string;

  constructor(dbPath: string = ':memory:', sparqlEndpoint?: string) {
    this.queryEngine = new QueryEngine();
    this._embedder = null;
    this._db = null;
    this._dbPath = dbPath;
    this._sparqlEndpoint = sparqlEndpoint || '';
  }


  async getDatabase(): Promise<Database.Database> {
    if (!this._db) {
      // Create directory if it doesn't exist (unless using :memory:)
      if (this._dbPath !== ':memory:') {
        const dir = path.dirname(this._dbPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }

      this._db = new Database(this._dbPath);
      sqliteVec.load(this._db);
      this.initializeSchema();
    }
    return this._db;
  }

  private initializeSchema(): void {
    if (!this._db) return;

    this._db.exec(`
      CREATE TABLE IF NOT EXISTS endpoint_info (
        sparql_endpoint TEXT PRIMARY KEY,
        indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE VIRTUAL TABLE IF NOT EXISTS ontology_index USING vec0(
        ontology_uri TEXT PRIMARY KEY,
        ontology_label TEXT NOT NULL,
        ontology_description TEXT,
        sparql_endpoint TEXT NOT NULL,
        embedding FLOAT[1024]
      );
    `);
  }


  async embed(text: string[], instruction?: string): Promise<Array<Float32Array>> {
    if (!this._embedder) {
      console.error('Initializing embedding model (Qwen3-Embedding-0.6B)...');
      try {
        // Try CUDA first
        this._embedder = await pipeline('feature-extraction', 'onnx-community/Qwen3-Embedding-0.6B-ONNX', {
          device: 'gpu',
        });
        console.error('Embedding model loaded successfully on GPU');
      } catch (error) {
        // Fallback to CPU
        console.error('GPU not available, falling back to CPU...');
        this._embedder = await pipeline('feature-extraction', 'onnx-community/Qwen3-Embedding-0.6B-ONNX');
        console.error('Embedding model loaded successfully on CPU');
      }
    }

    // Format text with instruction if provided (instruction-aware embeddings)
    const formattedTexts = text.map(t => {
      if (instruction) {
        return `Instruct: ${instruction}\nQuery: ${t}`;
      }
      return t;
    });

    // Process all texts in a single batch for better performance
    const result = await this._embedder(formattedTexts, {
      pooling: 'mean',
      normalize: true
    });
    const resultList = result.tolist();

    // Convert 2D JS list to array of Float32Arrays
    const embeddings = resultList.map((embedding: number[]) => new Float32Array(embedding));
    return embeddings;
  }

  private formatIdentifier(identifier: string): string {
    const uriSegment = identifier.split(/[#/]/).pop() || identifier;

    const parts = uriSegment
      .split(/[_\-\.\s]/)
      .map(s => s.toLowerCase())
      .filter(s => s.length > 0);

    if (parts.length === 0) return identifier;

    const first = parts[0];
    const rest = parts.slice(1).map(part =>
      part.charAt(0).toUpperCase() + part.slice(1)
    );

    return first + rest.join('');
  }

  public getReadableName(uri: string, label?: string): string {
    if (label) return label;
    return this.formatIdentifier(uri);
  }

  public getDefaultSources(): string[] {
    return this._sparqlEndpoint ? [this._sparqlEndpoint] : [];
  }

  async needsExploration(): Promise<boolean> {
    if (!this._sparqlEndpoint) return false;

    const db = await this.getDatabase();
    const stmt = db.prepare('SELECT COUNT(*) as count FROM ontology_index WHERE sparql_endpoint = ?');
    const result = stmt.get(this._sparqlEndpoint) as { count: number };

    // Need exploration if no data exists for this endpoint
    return result.count === 0;
  }

  async recordEndpoint(): Promise<void> {
    if (!this._sparqlEndpoint) return;

    const db = await this.getDatabase();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO endpoint_info (sparql_endpoint, indexed_at)
      VALUES (?, CURRENT_TIMESTAMP)
    `);
    stmt.run(this._sparqlEndpoint);
  }

  async executeQuery(query: string, sources: Array<string>): Promise<any[]> {
    // Rate limiting: 100ms delay before each query
    await new Promise(resolve => setTimeout(resolve, 100));

    const bindingsStream = await this.queryEngine.queryBindings(query, {
      sources,
    } as QueryStringContext);

    const bindings = await bindingsStream.toArray();
    return bindings.map(binding => {
      const result: any = {};
      for (const [variable, term] of binding) {
        result[variable.value] = {
          value: term.value,
          type: term.termType
        };
      }
      return result;
    });
  }

  // private async queryBatch(
  //   sources: string[],
  //   options: ExplorationOptions,
  //   offset: number,
  //   batchSize: number
  // ): Promise<any[]> {
  //   let query = `
  //     PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
  //     PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
  //     SELECT DISTINCT ?property ?domain ?range`;

  //   if (options.includeLabels) {
  //     query += ` ?propertyLabel ?domainLabel ?rangeLabel`;
  //   }

  //   if (options.includeDescriptions) {
  //     query += ` ?propertyDesc ?domainDesc ?rangeDesc`;
  //   }

  //   query += ` WHERE {
  //     ?property rdfs:domain ?domain ;
  //               rdfs:range ?range ;
  //               a rdf:Property .`;

  //   if (options.includeLabels) {
  //     query += `
  //     OPTIONAL { ?property rdfs:label ?propertyLabel . FILTER(LANG(?propertyLabel) = "en" || LANG(?propertyLabel) = "") }
  //     OPTIONAL { ?domain rdfs:label ?domainLabel . FILTER(LANG(?domainLabel) = "en" || LANG(?domainLabel) = "") }
  //     OPTIONAL { ?range rdfs:label ?rangeLabel . FILTER(LANG(?rangeLabel) = "en" || LANG(?rangeLabel) = "") }`;
  //   }

  //   if (options.includeDescriptions) {
  //     query += `
  //     OPTIONAL { ?property <http://dbpedia.org/ontology/abstract> ?propertyAbstract . FILTER(LANG(?propertyAbstract) = "en" || LANG(?propertyAbstract) = "") }
  //     OPTIONAL { ?property rdfs:comment ?propertyComment . FILTER(LANG(?propertyComment) = "en" || LANG(?propertyComment) = "") }
  //     OPTIONAL { ?property <http://www.w3.org/2004/02/skos/core#comment> ?propertySkosComment . FILTER(LANG(?propertySkosComment) = "en" || LANG(?propertySkosComment) = "") }
  //     OPTIONAL { ?domain <http://dbpedia.org/ontology/abstract> ?domainAbstract . FILTER(LANG(?domainAbstract) = "en" || LANG(?domainAbstract) = "") }
  //     OPTIONAL { ?domain rdfs:comment ?domainComment . FILTER(LANG(?domainComment) = "en" || LANG(?domainComment) = "") }
  //     OPTIONAL { ?domain <http://www.w3.org/2004/02/skos/core#comment> ?domainSkosComment . FILTER(LANG(?domainSkosComment) = "en" || LANG(?domainSkosComment) = "") }
  //     OPTIONAL { ?range <http://dbpedia.org/ontology/abstract> ?rangeAbstract . FILTER(LANG(?rangeAbstract) = "en" || LANG(?rangeAbstract) = "") }
  //     OPTIONAL { ?range rdfs:comment ?rangeComment . FILTER(LANG(?rangeComment) = "en" || LANG(?rangeComment) = "") }
  //     OPTIONAL { ?range <http://www.w3.org/2004/02/skos/core#comment> ?rangeSkosComment . FILTER(LANG(?rangeSkosComment) = "en" || LANG(?rangeSkosComment) = "") }
  //     BIND(COALESCE(?propertyAbstract, ?propertyComment, ?propertySkosComment) AS ?propertyDesc)
  //     BIND(COALESCE(?domainAbstract, ?domainComment, ?domainSkosComment) AS ?domainDesc)
  //     BIND(COALESCE(?rangeAbstract, ?rangeComment, ?rangeSkosComment) AS ?rangeDesc)`;
  //   }

  //   query += `
  //     FILTER(!CONTAINS(STR(?domain), "http://www.w3.org/2002/07/owl#"))
  //     FILTER(!CONTAINS(STR(?range), "http://www.w3.org/2002/07/owl#"))
  //     FILTER(!CONTAINS(STR(?domain), "http://www.openlinksw.com/schemas/"))
  //     FILTER(!CONTAINS(STR(?range), "http://www.openlinksw.com/schemas/"))
  //     FILTER(?domain != <http://www.w3.org/1999/02/22-rdf-syntax-ns#Property>)
  //     FILTER(?domain != <http://www.w3.org/2000/01/rdf-schema#Class>)
  //     FILTER(?range != <http://www.w3.org/1999/02/22-rdf-syntax-ns#Property>)
  //     FILTER(?range != <http://www.w3.org/2000/01/rdf-schema#Class>)
  //   }
  //   ORDER BY ?property ?domain ?range
  //   LIMIT ${batchSize}
  //   OFFSET ${offset}`;

  //   return await this.executeQuery(query, sources);
  // }

  // public async exploreProperties(
  //   sources: string[],
  //   options: ExplorationOptions = {}
  // ): Promise<Map<string, PropertyInfo>> {
  //   const batchSize = options.batchSize || 50;
  //   const propertyMap = new Map<string, PropertyInfo>();
  //   const typeMap = new Map<string, TypeInfo>();

  //   let offset = 0;
  //   let processedTotal = 0;
  //   let hasMore = true;

  //   console.error(`Starting exploration with sources: ${sources.join(', ')}`);
  //   console.error(`Batch size: ${batchSize}, Include labels: ${options.includeLabels}, Include descriptions: ${options.includeDescriptions}`);

  //   const getOrCreateType = (uri: string, label?: string, description?: string): TypeInfo => {
  //     if (!typeMap.has(uri)) {
  //       typeMap.set(uri, {
  //         typeUri: uri,
  //         label,
  //         description
  //       });
  //     }
  //     const type = typeMap.get(uri)!;
  //     if (label && !type.label) type.label = label;
  //     if (description && !type.description) type.description = description;
  //     return type;
  //   };

  //   while (hasMore) {
  //     try {
  //       const bindings = await this.queryBatch(sources, options, offset, batchSize);

  //       console.error(`Fetched ${bindings.length} bindings from SPARQL endpoint (offset: ${offset})`);

  //       if (bindings.length === 0) {
  //         console.error('No more bindings returned, ending exploration');
  //         hasMore = false;
  //         break;
  //       }

  //       for (const binding of bindings) {
  //         const propertyUri = binding.property?.value;
  //         const domainUri = binding.domain?.value;
  //         const rangeUri = binding.range?.value;

  //         if (!propertyUri || !domainUri || !rangeUri) continue;

  //         const propertyLabel = binding.propertyLabel?.value;
  //         const domainLabel = binding.domainLabel?.value;
  //         const rangeLabel = binding.rangeLabel?.value;

  //         const propertyDesc = binding.propertyDesc?.value;
  //         const domainDesc = binding.domainDesc?.value;
  //         const rangeDesc = binding.rangeDesc?.value;

  //         if (!propertyMap.has(propertyUri)) {
  //           propertyMap.set(propertyUri, {
  //             propertyUri,
  //             label: propertyLabel,
  //             description: propertyDesc,
  //             domainRangePairs: new Map(),
  //           });
  //         }

  //         const property = propertyMap.get(propertyUri)!;
  //         const domainType = getOrCreateType(domainUri, domainLabel, domainDesc);
  //         const rangeType = getOrCreateType(rangeUri, rangeLabel, rangeDesc);

  //         let key = domainUri + rangeUri;

  //         property.domainRangePairs.set(key, { domain: domainType, range: rangeType });
  //       }

  //       processedTotal += bindings.length;
  //       offset += batchSize;
  //       hasMore = bindings.length === batchSize;

  //       if (options.onProgress) {
  //         options.onProgress(processedTotal);
  //       }

  //       // Log last 10 properties (most recently added)
  //       const propertiesToLog = Array.from(propertyMap.values()).slice(-10);
  //       console.error(`\n--- Batch ${Math.floor(offset / batchSize)} processed (${processedTotal} total) ---`);
  //       propertiesToLog.forEach((prop, idx) => {
  //         const firstPair = Array.from(prop.domainRangePairs.values())[0];
  //         if (firstPair) {
  //           const propName = this.getReadableName(prop.propertyUri, prop.label);
  //           const domainName = this.getReadableName(firstPair.domain.typeUri, firstPair.domain.label);
  //           const rangeName = this.getReadableName(firstPair.range.typeUri, firstPair.range.label);
  //           console.error(`${idx + 1}. ${domainName} --[${propName}]--> ${rangeName}`);
  //         }
  //       });

  //       // Small delay to avoid overwhelming the endpoint
  //       await new Promise(resolve => setTimeout(resolve, 100));
  //     } catch (error) {
  //       console.error(`Error querying SPARQL endpoint at offset ${offset}:`, error);
  //       hasMore = false;
  //     }
  //   }

  //   console.error(`\n=== Exploration Complete ===`);
  //   console.error(`Total unique properties discovered: ${propertyMap.size}`);
  //   console.error(`Total bindings processed: ${processedTotal}`);

  //   // Save properties to vector database after exploration
  //   await this.saveToDatabase(propertyMap);

  //   // Record the endpoint that was used for this exploration
  //   await this.recordEndpoint();
  //   return propertyMap;
  // }

  public async exploreOntology(
    sources: string[],
    options: ExplorationOptions = {}
  ): Promise<Map<string, any>> {
    const batchSize = options.batchSize || 100;
    const ontologyMap = new Map<string, any>(); // TODO: Claude: Fix the any here - take the type from below. 

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

    // Save ontology to vector database after exploration
    await this.saveOntologyToDatabase(ontologyMap);

    // Record the endpoint that was used for this exploration
    await this.recordEndpoint();
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
        ?uri a rdfs:Class .
      } UNION {
        ?uri a rdf:Property .
      } UNION {
        ?uri a rdfs:Datatype .
      } UNION {
        ?prop rdfs:domain ?uri .
      } UNION {
        ?prop rdfs:range ?uri .
      }`;

    // TODO: Claude - We need to use it for embedding if comments / descriptions are not available, ultimately falling back to the URI if this is also not available.
    // However, there might be cases where rdfs:label is not available, but some other kind of property (e.g., skos:prefLabel) is used. 
    // => COALESCE them to ensure we always have a label, i.e. rdfs:label, skos:prefLabel, ...
    if (options.includeLabels) {
      query += `
      OPTIONAL { ?uri rdfs:label ?label . FILTER(LANG(?label) = "en" || LANG(?label) = "") }`;
    }

    // TODO: Claude - Same here, but prefer this over labels for embedding. It goes like this now: description || label || readableName(uri)
    if (options.includeDescriptions) {
      query += `
      OPTIONAL { ?uri rdfs:comment ?description . FILTER(LANG(?description) = "en" || LANG(?description) = "") }`;
    }

    query += `
      FILTER(!CONTAINS(STR(?uri), "http://www.w3.org/2002/07/owl#"))
      FILTER(!CONTAINS(STR(?uri), "http://www.openlinksw.com/schemas/"))
    }
    ORDER BY ?uri ?type
    LIMIT ${batchSize}
    OFFSET ${offset}`;

    return await this.executeQuery(query, sources);
  }

  async saveToDatabase(properties: Map<string, PropertyInfo>): Promise<void> {
    console.error(`\n=== Saving to Database ===`);
    console.error(`Processing ${properties.size} properties for database storage...`);

    const db = await this.getDatabase();
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO ontology_index (ontology_uri, ontology_type, ontology_label, ontology_description, sparql_endpoint, embedding)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const propertyTexts: string[] = [];
    const propertyInfos: PropertyInfo[] = [];

    console.error('Preparing property texts for embedding...');
    // Prepare property texts for embedding (description || label)
    for (const prop of properties.values()) {
      const embeddingText = prop.description || prop.label || '';
      if (embeddingText) {
        propertyTexts.push(embeddingText);
        propertyInfos.push(prop);
      }
    }

    console.error(`Prepared ${propertyTexts.length} properties for embedding`);

    // Generate embeddings in batch
    if (propertyTexts.length > 0) {
      const embeddings = await this.embed(propertyTexts);

      console.error('Saving to vector database...');
      // Save to database
      const transaction = db.transaction(() => {
        for (let i = 0; i < propertyTexts.length; i++) {
          const prop = propertyInfos[i];
          const embedding = embeddings[i];

          insertStmt.run(
            prop.propertyUri,
            'property',
            prop.label || '',
            prop.description || '',
            this._sparqlEndpoint,
            JSON.stringify(Array.from(embedding))
          );
        }
      });

      transaction();
      console.error(`Successfully saved ${propertyTexts.length} properties with embeddings to database`);
    } else {
      console.error('No properties to save to database');
    }
  }

  // TODO: Claude: Fix the any here too.
  async saveOntologyToDatabase(ontologyMap: Map<string, any>): Promise<void> {
    console.error(`\n=== Saving Ontology to Database ===`);
    console.error(`Processing ${ontologyMap.size} ontological constructs for database storage...`);

    const db = await this.getDatabase();
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO ontology_index (ontology_uri, ontology_type, ontology_label, ontology_description, sparql_endpoint, embedding)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const ontologyTexts: string[] = [];
    const ontologyInfos: OntologyInfo[] = [];

    console.error('Preparing ontology texts for embedding...');
    // Prepare ontology texts for embedding (description || label)
    for (const onto of ontologyMap.values()) {
      const embeddingText = onto.description || onto.label || this.getReadableName(onto.uri);
      if (embeddingText) {
        ontologyTexts.push(embeddingText);
        ontologyInfos.push(onto);
      }
    }

    console.error(`Prepared ${ontologyTexts.length} ontological constructs for embedding`);

    // Generate embeddings in batch
    if (ontologyTexts.length > 0) {
      const embeddings = await this.embed(ontologyTexts);

      console.error('Saving to vector database...');
      // Save to database
      const transaction = db.transaction(() => {
        for (let i = 0; i < ontologyTexts.length; i++) {
          const onto = ontologyInfos[i];
          const embedding = embeddings[i];

          // TODO: Claude - remove 
          insertStmt.run(
            onto.ontologyUri,
            onto.ontologyType,
            onto.label || '',
            onto.description || '',
            this._sparqlEndpoint,
            JSON.stringify(Array.from(embedding))
          );
        }
      });

      transaction();
      console.error(`Successfully saved ${ontologyTexts.length} ontological constructs with embeddings to database`);
    } else {
      console.error('No ontological constructs to save to database');
    }
  }

  // TODO Claude: Here just return the URI, label and description, nicely formatted.
  async searchOntology(userQuery: string, limit: number = 10): Promise<Array<{ uri: string, label: string, description: string, similarity: number }>> {
    if (!this._sparqlEndpoint) {
      throw new Error('SPARQL endpoint not configured for search');
    }

    const db = await this.getDatabase();

    // Generate embedding for user query
    const queryEmbedding = await this.embed([userQuery], 'Given a search query, retrieve a list of semantically similar ontological constructs');
    const queryVector = queryEmbedding[0];
    const searchStmt = db.prepare(`
      SELECT 
        ontology_uri,
        ontology_label,
        ontology_description,
        distance
      FROM ontology_index
      WHERE embedding MATCH ? AND sparql_endpoint = ?
      ORDER BY distance
      LIMIT ?
    `);

    const results = searchStmt.all(JSON.stringify(Array.from(queryVector)), this._sparqlEndpoint, limit);

    // TODO Claude: Format here already.
    return results.map((row: any) => ({
      uri: row.ontology_uri,
      label: row.ontology_label || '',
      description: row.ontology_description || '',
      similarity: 1 - row.distance
    }));
  }

  async searchAll(searchQuery: string, limit: number = 20, offset: number = 0): Promise<ResourceResult[]> {
    if (!this._sparqlEndpoint) {
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
      const results = await this.executeQuery(query, [this._sparqlEndpoint]);

      return results.map((binding: any) => ({
        uri: binding.resource?.value || '',
        label: binding.label?.value,
        description: binding.description?.value
      })).filter(result => result.uri); // Filter out empty URIs
    } catch (error) {
      throw error;
    }
  }

  private processResults(results: any[], directPropertiesMap: PropertyMap, position: 'subject' | 'object' | 'predicate', uri: string): void {
    for (const result of results) {
      if (position === 'predicate') {
        if (!result.subject || !result.object) continue;

        const subject = result.subject.value;
        const object = result.object.value;

        if (!directPropertiesMap.has(uri)) {
          directPropertiesMap.set(uri, []);
        }
        directPropertiesMap.get(uri)?.push({ value: { subject, predicate: uri, object }, position: 'predicate' });
      } else {
        if (!result.property || !result.value) continue;

        const property = result.property.value;
        const value = result.value.value;

        if (!directPropertiesMap.has(property)) {
          directPropertiesMap.set(property, []);
        }

        const entry = position === 'subject'
          ? { value: { subject: uri, predicate: property, object: value }, position }
          : { value: { subject: value, predicate: property, object: uri }, position };

        directPropertiesMap.get(property)?.push(entry);
      }
    }
  }

  private getOntoInfo(typeUri: string): OntologyInfo {

    // TODO: Claude: Determine ontology type based on URI, what gets passed in here is either
    // rdfs:Class, rdf:Property, rdfs:Datatype, (which are meta-metadata) ..., or some other (metadata) type (then just return "probably data").
    return ...
  }

  private async getDirectProperties(uri: string): Promise<{ info: OntologyInfo, props: PropertyMap }> {
    const directPropertiesMap: PropertyMap = new Map();

    // Subject Query (where URI is subject)
    const subjectQuery = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX dbo: <http://dbpedia.org/ontology/>
      SELECT DISTINCT ?property ?value WHERE {
        <${uri}> ?property ?value .
        FILTER(!CONTAINS(STR(?property), "http://www.w3.org/2002/07/owl#"))
        FILTER(!CONTAINS(STR(?property), "http://www.openlinksw.com/schemas/"))
        FILTER(?property != rdf:type)
        FILTER(IF(LANG(?value) != "", LANG(?value) = "en", true))
      }
      ORDER BY ?property ?value
    `;

    // Object Query (where URI is object)
    const objectQuery = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX dbo: <http://dbpedia.org/ontology/>
      SELECT DISTINCT ?property ?value WHERE {
        ?value ?property <${uri}> .
        FILTER(!CONTAINS(STR(?property), "http://www.w3.org/2002/07/owl#"))
        FILTER(!CONTAINS(STR(?property), "http://www.openlinksw.com/schemas/"))
        FILTER(?property != rdf:type)
      }
      ORDER BY ?property ?value
    `;

    // Predicate Query (where URI is predicate)
    const predicateQuery = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX dbo: <http://dbpedia.org/ontology/>
      SELECT DISTINCT ?subject ?object WHERE {
        ?subject <${uri}> ?object .
        FILTER(IF(LANG(?object) != "", LANG(?object) = "en", true))
      }
      ORDER BY ?subject ?object
    `;

    const typeQuery = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      SELECT ?type WHERE {
        <${uri}> rdf:type ?type .
        FILTER(!CONTAINS(STR(?type), "http://www.w3.org/2002/07/owl#"))
        FILTER(!CONTAINS(STR(?type), "http://www.openlinksw.com/schemas/"))
      }
    `;

    try {
      // Execute all three queries for direct properties
      const subjectResults = await this.executeQuery(subjectQuery, [this._sparqlEndpoint]);
      const objectResults = await this.executeQuery(objectQuery, [this._sparqlEndpoint]);
      const predicateResults = await this.executeQuery(predicateQuery, [this._sparqlEndpoint]);
      const typeResults = await this.executeQuery(typeQuery, [this._sparqlEndpoint]);

      this.processResults(subjectResults, directPropertiesMap, 'subject', uri);
      this.processResults(objectResults, directPropertiesMap, 'object', uri);
      this.processResults(predicateResults, directPropertiesMap, 'predicate', uri);
      let ty = typeResults.length > 0 ? typeResults[0].type.value : null;

      let ontoInfo = this.getOntoInfo(ty);

      return { info: ontoInfo, props: directPropertiesMap };
    } catch (error) {
      throw error;
    }
  }

  private async getParentURIs(uri: string): Promise<string[]> {
    const parentQuery = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX owl: <http://www.w3.org/2002/07/owl#>
      SELECT DISTINCT ?parent WHERE {
        {
          <${uri}> rdfs:subClassOf ?parent .
        } UNION {
          <${uri}> rdfs:subPropertyOf ?parent .
        }
        FILTER(?parent != <http://www.w3.org/2002/07/owl#Thing>)
        FILTER(?parent != <http://www.w3.org/2000/01/rdf-schema#Resource>)
        FILTER(?parent != <http://www.w3.org/2000/01/rdf-schema#Class>)
        FILTER(?parent != <http://www.w3.org/1999/02/22-rdf-syntax-ns#Property>)
        FILTER(!CONTAINS(STR(?parent), "http://www.w3.org/2002/07/owl#"))
        FILTER(!CONTAINS(STR(?parent), "http://www.openlinksw.com/schemas/"))
      }
    `;

    try {
      const results = await this.executeQuery(parentQuery, [this._sparqlEndpoint]);
      return results
        .filter(result => result.parent)
        .map(result => result.parent.value);
    } catch (error) {
      console.error('Error getting parent URIs:', error);
      return [];
    }
  }

  private async inspectInner(uri: string): Promise<{
    ontoInfo: OntologyInfo,
    props: PropertyMap
  }> {
    const allPropertiesMap: PropertyMap = new Map();

    // Add direct properties to the result
    const directProperties = await this.getDirectProperties(uri);
    for (const [property, entries] of directProperties.props) {
      if (!allPropertiesMap.has(property)) {
        allPropertiesMap.set(property, []);
      }

      for (const entry of entries) {
        allPropertiesMap.get(property)?.push({
          value: entry.value,
          position: entry.position,
        });
      }
    }

    // Recursively collect properties from parent URIs
    const parentURIs = await this.getParentURIs(uri);
    for (const parentURI of parentURIs) {
      const parentProperties = await this.inspectInner(parentURI);
      for (const [property, entries] of parentProperties.props) {
        if (!allPropertiesMap.has(property)) {
          allPropertiesMap.set(property, []);
        }

        for (const entry of entries) {
          allPropertiesMap.get(property)?.push(entry);
        }
      }
    }
    let isOnto = parentURIs.length > 0;
    let ontoInfo = directProperties.info;
    if (isOnto) {
      ontoInfo = this.getOntoInfo(uri);
    }
    return {
      ontoInfo,
      props: allPropertiesMap,
    };
  }

  public async inspect(uri: string): Promise<string> {
    if (!this._sparqlEndpoint) {
      throw new Error('SPARQL endpoint not configured');
    }

    // Get all properties (direct and inherited) using recursive traversal
    const allPropertiesMap = await this.inspectInner(uri);

    // Format the output based on resource type
    let response: string;

    // TODO: For Claude: Make this sound more robust and format niceles for an LLM specifically.
    if (allPropertiesMap.ontoInfo.ontologyType === "metadata") {
      response = `# Inspected URI '${uri}' IS Metadata and gives ifnormation about the schema. use in SPARQL Queries..\n\n`;
    } else {
      response = `# Inspected URI .. is probably data\n\n. Actual Data - thesea re realy data triples in the knowlege graph... `;
    }

    if (allPropertiesMap.props.size === 0) {
      response += 'No properties found for this resource.';
      return response;
    }

    /* TODO: For Claude: Render out the properties in a more readable format, like this:
  
    Need to differnatiate between ontological constructs and actual data triples. 
    For ontological constructs, show an example on how this coudl appear in a SPARQL query? Maybe? Not sure though...
    Like - if in subject position: "INSPECTED_URI_HERE PROP_HERE ?value" <-- retrieves all values for the inspected URI via the property.
    ^---- THis needs to be reformatted and made nicer, okay?
    */

  }

  public propertiesToStore(properties: Map<string, PropertyInfo>): Store {
    const store = new Store();

    // Define common predicates
    const rdfType = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
    const rdfsClass = namedNode('http://www.w3.org/2000/01/rdf-schema#Class');
    const rdfProperty = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#Property');
    const rdfsLabel = namedNode('http://www.w3.org/2000/01/rdf-schema#label');
    const rdfsComment = namedNode('http://www.w3.org/2000/01/rdf-schema#comment');
    const rdfsDomain = namedNode('http://www.w3.org/2000/01/rdf-schema#domain');
    const rdfsRange = namedNode('http://www.w3.org/2000/01/rdf-schema#range');

    const addedTypes = new Set<string>();

    for (const property of properties.values()) {
      const propertyNode = namedNode(property.propertyUri);

      // Add property declaration
      store.addQuad(quad(propertyNode, rdfType, rdfProperty));

      // Add property label
      if (property.label) {
        store.addQuad(quad(propertyNode, rdfsLabel, literal(property.label)));
      }

      // Add property description
      if (property.description) {
        store.addQuad(quad(propertyNode, rdfsComment, literal(property.description)));
      }

      // Add domain-range pairs
      for (const pair of property.domainRangePairs.values()) {
        const domainNode = namedNode(pair.domain.typeUri);
        const rangeNode = namedNode(pair.range.typeUri);

        store.addQuad(quad(propertyNode, rdfsDomain, domainNode));
        store.addQuad(quad(propertyNode, rdfsRange, rangeNode));

        // Add domain type declaration if not already added
        if (!addedTypes.has(pair.domain.typeUri)) {
          store.addQuad(quad(domainNode, rdfType, rdfsClass));
          if (pair.domain.label) {
            store.addQuad(quad(domainNode, rdfsLabel, literal(pair.domain.label)));
          }
          if (pair.domain.description) {
            store.addQuad(quad(domainNode, rdfsComment, literal(pair.domain.description)));
          }
          addedTypes.add(pair.domain.typeUri);
        }

        // Add range type declaration if not already added
        if (!addedTypes.has(pair.range.typeUri)) {
          store.addQuad(quad(rangeNode, rdfType, rdfsClass));
          if (pair.range.label) {
            store.addQuad(quad(rangeNode, rdfsLabel, literal(pair.range.label)));
          }
          if (pair.range.description) {
            store.addQuad(quad(rangeNode, rdfsComment, literal(pair.range.description)));
          }
          addedTypes.add(pair.range.typeUri);
        }
      }
    }

    return store;
  }
}