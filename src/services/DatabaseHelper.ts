import * as sqliteVec from "sqlite-vec";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { OntologyItem } from "../types";
import Logger from "../utils/logger.js";
import { resolveCachePath } from "../utils/cache.js";

export class DatabaseHelper {
  private _db: Database.Database | null = null;
  private _dbPath: string;

  constructor(dbPath: string = ":memory:") {
    this._dbPath = resolveCachePath(dbPath);
  }

  async getDatabase(): Promise<Database.Database> {
    if (!this._db) {
      // Create directory if it doesn't exist (unless using :memory:)
      if (this._dbPath !== ":memory:") {
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

  async needsExploration(sparqlEndpoint: string): Promise<boolean> {
    if (!sparqlEndpoint) return false;

    const db = await this.getDatabase();
    const stmt = db.prepare(
      "SELECT COUNT(*) as count FROM ontology_index WHERE sparql_endpoint = ?"
    );
    const result = stmt.get(sparqlEndpoint) as { count: number };

    // Need exploration if no data exists for this endpoint
    return result.count === 0;
  }

  async recordEndpoint(sparqlEndpoint: string): Promise<void> {
    if (!sparqlEndpoint) return;

    const db = await this.getDatabase();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO endpoint_info (sparql_endpoint, indexed_at)
      VALUES (?, CURRENT_TIMESTAMP)
    `);
    stmt.run(sparqlEndpoint);
  }

  async saveOntologyToDatabase(
    ontologyMap: Map<string, OntologyItem>,
    sparqlEndpoint: string,
    embeddings: Array<Float32Array>
  ): Promise<void> {
    Logger.info('=== Saving Ontology to Database ===');
    Logger.info(`Processing ${ontologyMap.size} ontological constructs for database storage...`);

    const db = await this.getDatabase();
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO ontology_index (ontology_uri, ontology_label, ontology_description, sparql_endpoint, embedding)
      VALUES (?, ?, ?, ?, ?)
    `);

    Logger.info('Saving to vector database...');
    // Save to database
    const transaction = db.transaction(() => {
      let i = 0;
      for (const onto of ontologyMap.values()) {
        const embedding = embeddings[i++];

        insertStmt.run(
          onto.uri,
          onto.label || "",
          onto.description || "",
          sparqlEndpoint,
          JSON.stringify(Array.from(embedding))
        );
      }
    });

    transaction();
    Logger.info(`Successfully saved ${ontologyMap.size} ontological constructs with embeddings to database`);
  }

  async searchOntology(
    queryVector: Float32Array,
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
    const db = await this.getDatabase();

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

    const results = searchStmt.all(
      JSON.stringify(Array.from(queryVector)),
      sparqlEndpoint,
      limit
    );

    return results.map((row: any) => ({
      uri: row.ontology_uri,
      label: row.ontology_label || "",
      description: row.ontology_description || "",
      similarity: Math.round((1 - row.distance) * 100) / 100,
    }));
  }
}
