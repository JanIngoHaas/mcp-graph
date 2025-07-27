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
      
      CREATE VIRTUAL TABLE IF NOT EXISTS class_index USING vec0(
        ontology_uri TEXT PRIMARY KEY,
        ontology_label TEXT NOT NULL,
        ontology_description TEXT,
        sparql_endpoint TEXT NOT NULL,
        embedding FLOAT[1024]
      );
      
      CREATE VIRTUAL TABLE IF NOT EXISTS property_index USING vec0(
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
    const classStmt = db.prepare(
      "SELECT COUNT(*) as count FROM class_index WHERE sparql_endpoint = ?"
    );
    const propertyStmt = db.prepare(
      "SELECT COUNT(*) as count FROM property_index WHERE sparql_endpoint = ?"
    );

    const classResult = classStmt.get(sparqlEndpoint) as { count: number };
    const propertyResult = propertyStmt.get(sparqlEndpoint) as {
      count: number;
    };

    // Need exploration if no data exists for this endpoint in either table
    return classResult.count === 0 && propertyResult.count === 0;
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

  async saveClassesToDatabase(
    classMap: Map<string, OntologyItem>,
    sparqlEndpoint: string,
    embeddings: Array<Float32Array>
  ): Promise<void> {
    Logger.info(`Saving ${classMap.size} classes to database...`);

    const db = await this.getDatabase();
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO class_index (ontology_uri, ontology_label, ontology_description, sparql_endpoint, embedding)
      VALUES (?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction(() => {
      let i = 0;
      for (const classItem of classMap.values()) {
        const embedding = embeddings[i++];

        insertStmt.run(
          classItem.uri,
          classItem.label || "",
          classItem.description || "",
          sparqlEndpoint,
          JSON.stringify(Array.from(embedding))
        );
      }
    });

    transaction();
    Logger.info(
      `Successfully saved ${classMap.size} classes with embeddings to database`
    );
  }

  async savePropertiesToDatabase(
    propertyMap: Map<string, OntologyItem>,
    sparqlEndpoint: string,
    embeddings: Array<Float32Array>
  ): Promise<void> {
    Logger.info(`Saving ${propertyMap.size} properties to database...`);

    const db = await this.getDatabase();
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO property_index (ontology_uri, ontology_label, ontology_description, sparql_endpoint, embedding)
      VALUES (?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction(() => {
      let i = 0;
      for (const propertyItem of propertyMap.values()) {
        const embedding = embeddings[i++];

        insertStmt.run(
          propertyItem.uri,
          propertyItem.label || "",
          propertyItem.description || "",
          sparqlEndpoint,
          JSON.stringify(Array.from(embedding))
        );
      }
    });

    transaction();
    Logger.info(
      `Successfully saved ${propertyMap.size} properties with embeddings to database`
    );
  }

  private async searchGeneric(
    queryVector: Float32Array,
    tableName: string,
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
      FROM ${tableName}
      WHERE embedding MATCH ? AND sparql_endpoint = ?
      ORDER BY distance
      LIMIT ?
    `);

    const queryVectorStr = JSON.stringify(Array.from(queryVector));

    const results = searchStmt.all(queryVectorStr, sparqlEndpoint, limit);

    return results.map((row: any) => {
      // sqlite-vec MATCH returns cosine distance, convert to similarity
      const similarity = Math.max(0, Math.min(1, 1 - row.distance));
      return {
        uri: row.ontology_uri,
        label: row.ontology_label || "",
        description: row.ontology_description || "",
        similarity,
      };
    });
  }

  async searchOntologyWithVector(
    queryVector: Float32Array,
    searchType: "class" | "property",
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
    let tableName = "";
    if (searchType === "class") {
      tableName = "class_index";
    } else if (searchType === "property") {
      tableName = "property_index";
    }

    return this.searchGeneric(queryVector, tableName, sparqlEndpoint, limit);
  }
}
