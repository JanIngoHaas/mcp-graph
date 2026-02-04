
import { Quad } from "@rdfjs/types";

/**
 * Filter condition with support for property path traversal
 */
export interface QueryBuilderFilter {
    /** Property path, use `->` between segments (e.g., 'kg:relatedTo -> rdfs:label', 'kg:year') */
    path: string;
    /** Comparison operator */
    operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'contains' | 'search';
    /** The comparison value */
    value: string;
}

/**
 * Query builder parameters
 */
export interface QueryBuilderParams {
    /** The RDF class URI to query */
    type: string;
    /** Filter conditions applied with AND logic */
    filters?: QueryBuilderFilter[];
    /** Property paths to return as columns */
    project: string[];
    /** Maximum number of results */
    limit?: number;
}

/**
 * Query builder result
 */
export interface QueryBuilderResult {
    /** The resulting quads */
    quads: Quad[];
    /** Number of results */
    count: number;
    /** The original query parameters */
    query: QueryBuilderParams;
}

/**
 * Parsed property path result
 */
export interface ParsedPropertyPath {
    /** The segments of the path (e.g., ['authoredBy', 'label']) */
    segments: string[];
    /** The variable name for the final value */
    finalVariable: string;
    /** The SPARQL triple patterns needed */
    patterns: string[];
    /** A unique identifier for this path */
    pathId: string;
}
