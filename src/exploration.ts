import { QueryEngine } from '@comunica/query-sparql';
import { QueryStringContext } from '@comunica/types';
import { Store, DataFactory, Quad } from 'n3';
import { FeatureExtractionPipeline, Message, pipeline, TextGenerationOutput, TextGenerationPipeline } from "@huggingface/transformers";
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

export class ExplorationService {
  private queryEngine: QueryEngine;
  private _generator: TextGenerationPipeline | null;
  private _embedder: FeatureExtractionPipeline | null;
  private _db: Database.Database | null;
  private _dbPath: string;
  private _sparqlEndpoint: string;
  private _llmBasedExampleQuery: boolean;

  constructor(dbPath: string = ':memory:', sparqlEndpoint?: string) {
    this.queryEngine = new QueryEngine();
    this._generator = null;
    this._embedder = null;
    this._db = null;
    this._dbPath = dbPath;
    this._sparqlEndpoint = sparqlEndpoint || '';
    this._llmBasedExampleQuery = process.env.LLM_BASED_EXAMPLE_QUERY?.trim() === 'true';
  }

  async shutdownGenerator() {
    if (this._generator) {
      await this._generator.dispose();
      this._generator = null;
    }
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

      CREATE TABLE IF NOT EXISTS domain_prop_range (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain_uri TEXT NOT NULL,
        property_uri TEXT NOT NULL,
        range_uri TEXT NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_domain_prop_range_property_uri ON domain_prop_range(property_uri);
      
      CREATE VIRTUAL TABLE IF NOT EXISTS query_index USING vec0(
        id INTEGER PRIMARY KEY,
        example_query TEXT NOT NULL,
        property_description TEXT NOT NULL,
        sparql_endpoint TEXT NOT NULL,
        embedding FLOAT[1024]
      );
    `);
  }

  async getGenerator() {
    if (!this._generator) {
      console.error('Initializing text generation model (SmolLM2-1.7B-Instruct)...');
      try {
        // Try CUDA first
        this._generator = await pipeline("text-generation", "HuggingFaceTB/SmolLM2-1.7B-Instruct", {
          device: 'gpu',
        }) as TextGenerationPipeline;
        console.error('Text generation model loaded successfully on GPU');
      } catch (error) {
        // Fallback to CPU
        console.error('GPU not available, falling back to CPU...');
        this._generator = await pipeline("text-generation", "HuggingFaceTB/SmolLM2-1.7B-Instruct") as TextGenerationPipeline;
        console.error('Text generation model loaded successfully on CPU');
      }
    }
    return this._generator;
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
    const stmt = db.prepare('SELECT COUNT(*) as count FROM query_index WHERE sparql_endpoint = ?');
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

  private async queryBatch(
    sources: string[],
    options: ExplorationOptions,
    offset: number,
    batchSize: number
  ): Promise<any[]> {
    let query = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      SELECT DISTINCT ?property ?domain ?range`;

    if (options.includeLabels) {
      query += ` ?propertyLabel ?domainLabel ?rangeLabel`;
    }

    if (options.includeDescriptions) {
      query += ` ?propertyDesc ?domainDesc ?rangeDesc`;
    }

    query += ` WHERE {
      ?property rdfs:domain ?domain ;
                rdfs:range ?range ;
                a rdf:Property .`;

    if (options.includeLabels) {
      query += `
      OPTIONAL { ?property rdfs:label ?propertyLabel . FILTER(LANG(?propertyLabel) = "en" || LANG(?propertyLabel) = "") }
      OPTIONAL { ?domain rdfs:label ?domainLabel . FILTER(LANG(?domainLabel) = "en" || LANG(?domainLabel) = "") }
      OPTIONAL { ?range rdfs:label ?rangeLabel . FILTER(LANG(?rangeLabel) = "en" || LANG(?rangeLabel) = "") }`;
    }

    if (options.includeDescriptions) {
      query += `
      OPTIONAL { ?property <http://dbpedia.org/ontology/abstract> ?propertyAbstract . FILTER(LANG(?propertyAbstract) = "en" || LANG(?propertyAbstract) = "") }
      OPTIONAL { ?property rdfs:comment ?propertyComment . FILTER(LANG(?propertyComment) = "en" || LANG(?propertyComment) = "") }
      OPTIONAL { ?property <http://www.w3.org/2004/02/skos/core#comment> ?propertySkosComment . FILTER(LANG(?propertySkosComment) = "en" || LANG(?propertySkosComment) = "") }
      OPTIONAL { ?domain <http://dbpedia.org/ontology/abstract> ?domainAbstract . FILTER(LANG(?domainAbstract) = "en" || LANG(?domainAbstract) = "") }
      OPTIONAL { ?domain rdfs:comment ?domainComment . FILTER(LANG(?domainComment) = "en" || LANG(?domainComment) = "") }
      OPTIONAL { ?domain <http://www.w3.org/2004/02/skos/core#comment> ?domainSkosComment . FILTER(LANG(?domainSkosComment) = "en" || LANG(?domainSkosComment) = "") }
      OPTIONAL { ?range <http://dbpedia.org/ontology/abstract> ?rangeAbstract . FILTER(LANG(?rangeAbstract) = "en" || LANG(?rangeAbstract) = "") }
      OPTIONAL { ?range rdfs:comment ?rangeComment . FILTER(LANG(?rangeComment) = "en" || LANG(?rangeComment) = "") }
      OPTIONAL { ?range <http://www.w3.org/2004/02/skos/core#comment> ?rangeSkosComment . FILTER(LANG(?rangeSkosComment) = "en" || LANG(?rangeSkosComment) = "") }
      BIND(COALESCE(?propertyAbstract, ?propertyComment, ?propertySkosComment) AS ?propertyDesc)
      BIND(COALESCE(?domainAbstract, ?domainComment, ?domainSkosComment) AS ?domainDesc)
      BIND(COALESCE(?rangeAbstract, ?rangeComment, ?rangeSkosComment) AS ?rangeDesc)`;
    }

    query += `
      FILTER(!CONTAINS(STR(?domain), "http://www.w3.org/2002/07/owl#"))
      FILTER(!CONTAINS(STR(?range), "http://www.w3.org/2002/07/owl#"))
      FILTER(!CONTAINS(STR(?domain), "http://www.openlinksw.com/schemas/"))
      FILTER(!CONTAINS(STR(?range), "http://www.openlinksw.com/schemas/"))
      FILTER(?domain != <http://www.w3.org/1999/02/22-rdf-syntax-ns#Property>)
      FILTER(?domain != <http://www.w3.org/2000/01/rdf-schema#Class>)
      FILTER(?range != <http://www.w3.org/1999/02/22-rdf-syntax-ns#Property>)
      FILTER(?range != <http://www.w3.org/2000/01/rdf-schema#Class>)
    }
    ORDER BY ?property ?domain ?range
    LIMIT ${batchSize}
    OFFSET ${offset}`;

    return await this.executeQuery(query, sources);
  }

  public async exploreProperties(
    sources: string[],
    options: ExplorationOptions = {}
  ): Promise<Map<string, PropertyInfo>> {
    const batchSize = options.batchSize || 50;
    const propertyMap = new Map<string, PropertyInfo>();
    const typeMap = new Map<string, TypeInfo>();

    let offset = 0;
    let processedTotal = 0;
    let hasMore = true;

    console.error(`Starting exploration with sources: ${sources.join(', ')}`);
    console.error(`Batch size: ${batchSize}, Include labels: ${options.includeLabels}, Include descriptions: ${options.includeDescriptions}`);

    const getOrCreateType = (uri: string, label?: string, description?: string): TypeInfo => {
      if (!typeMap.has(uri)) {
        typeMap.set(uri, {
          typeUri: uri,
          label,
          description
        });
      }
      const type = typeMap.get(uri)!;
      if (label && !type.label) type.label = label;
      if (description && !type.description) type.description = description;
      return type;
    };

    while (hasMore) {
      try {
        const bindings = await this.queryBatch(sources, options, offset, batchSize);

        console.error(`Fetched ${bindings.length} bindings from SPARQL endpoint (offset: ${offset})`);

        if (bindings.length === 0) {
          console.error('No more bindings returned, ending exploration');
          hasMore = false;
          break;
        }

        for (const binding of bindings) {
          const propertyUri = binding.property?.value;
          const domainUri = binding.domain?.value;
          const rangeUri = binding.range?.value;

          if (!propertyUri || !domainUri || !rangeUri) continue;

          const propertyLabel = binding.propertyLabel?.value;
          const domainLabel = binding.domainLabel?.value;
          const rangeLabel = binding.rangeLabel?.value;

          const propertyDesc = binding.propertyDesc?.value;
          const domainDesc = binding.domainDesc?.value;
          const rangeDesc = binding.rangeDesc?.value;

          if (!propertyMap.has(propertyUri)) {
            propertyMap.set(propertyUri, {
              propertyUri,
              label: propertyLabel,
              description: propertyDesc,
              domainRangePairs: new Map(),
            });
          }

          const property = propertyMap.get(propertyUri)!;
          const domainType = getOrCreateType(domainUri, domainLabel, domainDesc);
          const rangeType = getOrCreateType(rangeUri, rangeLabel, rangeDesc);

          let key = domainUri + rangeUri;

          property.domainRangePairs.set(key, { domain: domainType, range: rangeType });
        }

        processedTotal += bindings.length;
        offset += batchSize;
        hasMore = bindings.length === batchSize;

        if (options.onProgress) {
          options.onProgress(processedTotal);
        }

        // Log last 10 properties (most recently added)
        const propertiesToLog = Array.from(propertyMap.values()).slice(-10);
        console.error(`\n--- Batch ${Math.floor(offset / batchSize)} processed (${processedTotal} total) ---`);
        propertiesToLog.forEach((prop, idx) => {
          const firstPair = Array.from(prop.domainRangePairs.values())[0];
          if (firstPair) {
            const propName = this.getReadableName(prop.propertyUri, prop.label);
            const domainName = this.getReadableName(firstPair.domain.typeUri, firstPair.domain.label);
            const rangeName = this.getReadableName(firstPair.range.typeUri, firstPair.range.label);
            console.error(`${idx + 1}. ${domainName} --[${propName}]--> ${rangeName}`);
          }
        });

        // Small delay to avoid overwhelming the endpoint
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Error querying SPARQL endpoint at offset ${offset}:`, error);
        hasMore = false;
      }
    }

    console.error(`\n=== Exploration Complete ===`);
    console.error(`Total unique properties discovered: ${propertyMap.size}`);
    console.error(`Total bindings processed: ${processedTotal}`);

    // Save properties to vector database after exploration
    await this.saveToDatabase(propertyMap);

    // Record the endpoint that was used for this exploration
    await this.recordEndpoint();
    await this.shutdownGenerator();
    return propertyMap;
  }

  async generateExampleQueries(prop: PropertyInfo): Promise<Array<string>> {
    console.error(`Generating example queries for property: ${this.getReadableName(prop.propertyUri, prop.label)}`);

    if (!this._llmBasedExampleQuery) {
      // Static query generation, one per domain-range pair
      const staticQueries: string[] = [];
      for (const pair of prop.domainRangePairs.values()) {
        const domainName = this.getReadableName(pair.domain.typeUri, pair.domain.label);
        const rangeName = this.getReadableName(pair.range.typeUri, pair.range.label);
        const propName = this.getReadableName(prop.propertyUri, prop.label);
        staticQueries.push(`${domainName} --[${propName}]--> ${rangeName}`);
      }
      return staticQueries;
    }

    let overallOut = [] as Array<string>;

    for (const pair of prop.domainRangePairs.values()) {
      let domainName = this.getReadableName(pair.domain.typeUri, pair.domain.label);
      let rangeName = this.getReadableName(pair.range.typeUri, pair.range.label);
      let propName = this.getReadableName(prop.propertyUri, prop.label);

      const messages = [{
        role: 'system',
        content: `You are an expert in generating example natural language queries from RDF properties.
        Given a triple with a property, domain, and range, generate a natural language query that uses this property.
        Example: Given the property 'human--[hasPet]-->animal', generate a query like "Find people who have more than five animals as pets.". Do not output anything else, just your invented query matching the property. No explanations, no additional text, just your own invented query matching the property.`
      },
      {
        role: 'user',
        content: `${domainName}--[${propName}]-->[${rangeName}]`
      }];

      let generator = await this.getGenerator();
      let out = await generator(messages, {
        max_new_tokens: 256,
      }) as TextGenerationOutput;

      const generatedText = out[0].generated_text;
      const output = (Array.isArray(generatedText) ? generatedText[generatedText.length - 1] : generatedText) as Message;
      const outputText = output.content.trim();
      if (outputText) {
        console.error(`Generated query for ${domainName}--[${propName}]-->${rangeName}: "${outputText}"`);
        overallOut.push(outputText);
      }
      console.error(`
`);
    }

    return overallOut;
  }

  private formatPairDescription(prop: PropertyInfo, pair: {domain: TypeInfo, range: TypeInfo}): string {
    const propName = this.getReadableName(prop.propertyUri, prop.label);
    const domainName = this.getReadableName(pair.domain.typeUri, pair.domain.label);
    const rangeName = this.getReadableName(pair.range.typeUri, pair.range.label);
    
    let desc = `**${domainName} --[${propName}]--> ${rangeName}**\n`;
    desc += `   **Property**:\n`;
    desc += `   - URI: ${prop.propertyUri}\n`;
    desc += `   - Name: ${propName}\n`;
    if (prop.description) {
      desc += `   - Description: ${prop.description}\n`;
    }
    
    desc += `   **Domain**:\n`;
    desc += `   - URI: ${pair.domain.typeUri}\n`;
    desc += `   - Name: ${domainName}\n`;
    if (pair.domain.description) {
      desc += `   - Description: ${pair.domain.description}\n`;
    }
    
    desc += `   **Range**:\n`;
    desc += `   - URI: ${pair.range.typeUri}\n`;
    desc += `   - Name: ${rangeName}\n`;
    if (pair.range.description) {
      desc += `   - Description: ${pair.range.description}\n`;
    }
    
    return desc.trim();
  }

  private createPropertyDescription(prop: PropertyInfo): string[] {
    const pairs = Array.from(prop.domainRangePairs.values());
    return pairs.map(pair => this.formatPairDescription(prop, pair));
  }

  private generateTriples(prop: PropertyInfo): Array<{domainUri: string, propertyUri: string, rangeUri: string}> {
    const triples: Array<{domainUri: string, propertyUri: string, rangeUri: string}> = [];
    
    for (const pair of prop.domainRangePairs.values()) {
      triples.push({
        domainUri: pair.domain.typeUri,
        propertyUri: prop.propertyUri,
        rangeUri: pair.range.typeUri
      });
    }
    
    return triples;
  }

  async saveToDatabase(properties: Map<string, PropertyInfo>): Promise<void> {
    console.error(`\n=== Saving to Database ===`);
    console.error(`Processing ${properties.size} properties for database storage...`);

    const db = await this.getDatabase();
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO query_index (example_query, property_description, sparql_endpoint, embedding)
      VALUES (?, ?, ?, ?)
    `);

    const insertTripleStmt = db.prepare(`
      INSERT OR REPLACE INTO domain_prop_range (domain_uri, property_uri, range_uri)
      VALUES (?, ?, ?)
    `);

    const allQueries: string[] = [];
    const queryDescriptionMap = new Map<string, string>();
    const allTriples: Array<{domainUri: string, propertyUri: string, rangeUri: string}> = [];

    console.error('Generating example queries, descriptions, and triples...');
    // Generate all example queries, descriptions, and triples
    for (const prop of properties.values()) {
      const descriptions = this.createPropertyDescription(prop);
      const queries = await this.generateExampleQueries(prop);
      const triples = this.generateTriples(prop);

      // Both modes should have 1:1 pairing between queries and descriptions
      for (let i = 0; i < queries.length; i++) {
        allQueries.push(queries[i]);
        queryDescriptionMap.set(queries[i], descriptions[i]);
      }

      // Add triples to the collection
      allTriples.push(...triples);
    }

    console.error(`Generated ${allQueries.length} total example queries`);

    // Generate embeddings in batch with instruction for example queries
    if (allQueries.length > 0) {
      let embeddings;

      embeddings = await this.embed(allQueries);

      console.error('Saving to vector database...');
      // Save to database
      const transaction = db.transaction(() => {
        for (let i = 0; i < allQueries.length; i++) {
          const query = allQueries[i];
          const description = queryDescriptionMap.get(query)!;
          const embedding = embeddings[i];

          // Insert into consolidated table with vector
          insertStmt.run(query, description, this._sparqlEndpoint, JSON.stringify(Array.from(embedding)));
        }
      });

      transaction();
      console.error(`Successfully saved ${allQueries.length} queries with embeddings to database`);
    } else {
      console.error('No queries to save to database');
    }

    // Save triples to database
    if (allTriples.length > 0) {
      console.error(`Saving ${allTriples.length} triples to database...`);
      const tripleTransaction = db.transaction(() => {
        for (const triple of allTriples) {
          insertTripleStmt.run(triple.domainUri, triple.propertyUri, triple.rangeUri);
        }
      });
      
      tripleTransaction();
      console.error(`Successfully saved ${allTriples.length} triples to domain_prop_range table`);
    } else {
      console.error('No triples to save to database');
    }
  }

  async searchSimilarQueries(userQuery: string, limit: number = 10): Promise<Array<{ query: string, description: string, similarity: number }>> {
    if (!this._sparqlEndpoint) {
      throw new Error('jendpoint configured for search');
    }

    const db = await this.getDatabase();

    // Generate embedding for user query with search instruction

    let queryInstruction;

    if (this._llmBasedExampleQuery) {
      queryInstruction = 'Given a search query, retrieve a list of semantically similar queries';
    } else {
      queryInstruction = 'Given a search query, retrieve a list of semantically similar documents';
    }

    const queryEmbedding = await this.embed([userQuery], queryInstruction);
    const queryVector = queryEmbedding[0];
    const searchStmt = db.prepare(`
      SELECT 
        example_query,
        property_description,
        distance
      FROM query_index
      WHERE embedding MATCH ? AND sparql_endpoint = ?
      ORDER BY distance
      LIMIT ?
    `);

    const results = searchStmt.all(JSON.stringify(Array.from(queryVector)), this._sparqlEndpoint, limit);

    return results.map((row: any) => ({
      query: row.example_query,
      description: row.property_description,
      similarity: 1 - row.distance
    }));
  }

  async searchResources(searchQuery: string, limit: number = 20, offset: number = 0): Promise<ResourceResult[]> {
    if (!this._sparqlEndpoint) {
      throw new Error('SPARQL endpoint not configured for resource search');
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

  public async inspect(uri: string): Promise<string> {
    if (!this._sparqlEndpoint) {
      throw new Error('SPARQL endpoint not configured');
    }

    let map = new Map<string, Array<{value: string, direction: 'subject' | 'object'}>>();

    // Query for outgoing properties (where URI is subject)
    let outgoingQuery = `
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

    // Query for incoming properties (where URI is object)
    let incomingQuery = `
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
    
    try {
      // Execute both queries
      const outgoingResults = await this.executeQuery(outgoingQuery, [this._sparqlEndpoint]);
      const incomingResults = await this.executeQuery(incomingQuery, [this._sparqlEndpoint]);

      // Process outgoing results
      for(const result of outgoingResults) {
        if (!result.property || !result.value) continue;
        
        const property = result.property.value;
        const value = result.value.value;

        if (!map.has(property)) {
          map.set(property, []);
        }
        map.get(property)?.push({value, direction: 'subject'});
      }

      // Process incoming results
      for(const result of incomingResults) {
        if (!result.property || !result.value) continue;
        
        const property = result.property.value;
        const value = result.value.value;

        if (!map.has(property)) {
          map.set(property, []);
        }
        map.get(property)?.push({value, direction: 'object'});
      }

      // Format the output
      let response = `Inspecting resource: **${uri}**\n\n`;
      
      if (map.size === 0) {
        response += 'No properties found for this resource.';
        return response;
      }

      for (const [property, entries] of map) {
        const propertyName = this.getReadableName(property);
        response += `**Property: ${property}** (Label: ${propertyName})\n`;
        
        entries.forEach(entry => {
          response += `   [as ${entry.direction}] ${entry.value}\n`;
        });
        response += '\n';
      }

      return response.trim();
    } catch (error) {
      throw error;
    }
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