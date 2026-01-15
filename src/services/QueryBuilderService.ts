import { QueryService } from "./QueryService.js";
import { PrefixManager } from "../utils/PrefixManager.js";
import { resolveLabel, formatSparqlValue, getReadableName, formatLocalName, resolvePropertyToUri } from "../utils/uriUtils.js";
import { Quad } from "@rdfjs/types";
import { PathParser } from "../utils/PathParser.js";
import { QueryParserService, FallbackBackend } from "../utils/queryParser.js";

/**
 * Filter condition with support for property path traversal
 */
export interface QueryBuilderFilter {
    /** Property path, dot-separated for traversal (e.g., 'dblp:authoredBy.label', 'dblp:yearOfPublication') */
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
interface ParsedPropertyPath {
    /** The segments of the path (e.g., ['authoredBy', 'label']) */
    segments: string[];
    /** The variable name for the final value */
    finalVariable: string;
    /** The SPARQL triple patterns needed */
    patterns: string[];
    /** A unique identifier for this path */
    pathId: string;
}

/**
 * Service for building structured SPARQL queries with property path traversal
 */
export class QueryBuilderService {
    private pathParser: PathParser;

    constructor(
        private queryService: QueryService,
        private sparqlEndpoint: string,
        private queryParser: QueryParserService
    ) {
        this.pathParser = new PathParser();
    }

    /**
     * Parse property path using PathParser logic
     */
    private splitPropertyPath(path: string): string[] {
        return this.pathParser.parse(path);
    }

    /**
     * Parse a property path and generate the necessary SPARQL patterns and variable names.
     */
    private parsePropertyPath(
        path: string,
        baseVariable: string,
        pathId: string
    ): ParsedPropertyPath {
        const segments = this.splitPropertyPath(path);
        const patterns: string[] = [];

        let currentVariable = baseVariable;

        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            const propertyUri = resolvePropertyToUri(segment);
            const formattedProperty = propertyUri;

            const isLast = i === segments.length - 1;
            const nextVariable = isLast
                ? `?${pathId}`
                : `?${pathId}_${i}`;

            patterns.push(`${currentVariable} ${formattedProperty} ${nextVariable} .`);
            currentVariable = nextVariable;
        }

        return {
            segments,
            finalVariable: currentVariable,
            patterns,
            pathId,
        };
    }

    /**
     * Build a SPARQL filter expression
     */
    private buildFilterExpression(
        variable: string,
        operator: string,
        value: string
    ): string {
        if (operator === 'search' || operator === 'contains') {
            return this.queryParser.parseAndGeneratePattern(value, variable);
        }

        const validOps = ['=', '!=', '>', '<', '>=', '<='];
        if (!validOps.includes(operator)) {
            throw new Error(`Unsupported operator: ${operator}`);
        }

        if (value.startsWith('"') || value.startsWith("'") || value.startsWith('<')) {
            return `FILTER(${variable} ${operator} ${value})`;
        }

        const numValue = parseFloat(value);
        if (!isNaN(numValue) && value.trim() === numValue.toString()) {
            return `FILTER(${variable} ${operator} ${numValue})`;
        } else {
            return `FILTER(STR(${variable}) ${operator} "${value}")`;
        }
    }

    /**
     * Execute a query builder request
     */
    async executeQuery(params: QueryBuilderParams): Promise<QueryBuilderResult> {
        const { type, filters = [], project, limit = 100 } = params;

        if (!type) throw new Error("Type parameter is required");
        if (!project || project.length === 0) throw new Error("Project parameter is required");

        const constructPatterns: string[] = [];
        const wherePatterns: string[] = [];
        const projectionPaths: Map<string, ParsedPropertyPath> = new Map();
        const filterPaths: Map<string, ParsedPropertyPath> = new Map();

        let pathCounter = 0;
        const pathIds = new Map<string, string>();
        const getPathId = (path: string) => {
            if (!pathIds.has(path)) {
                pathIds.set(path, `p${pathCounter++}`);
            }
            return pathIds.get(path)!;
        };

        const formattedType = formatSparqlValue(type);
        constructPatterns.push(`?entity a ${formattedType} .`);
        wherePatterns.push(`?entity a ${formattedType} .`);

        for (const path of project) {
            const parsed = this.parsePropertyPath(path, '?entity', getPathId(path));
            projectionPaths.set(path, parsed);
        }

        for (const filter of filters) {
            if (!projectionPaths.has(filter.path)) {
                const parsed = this.parsePropertyPath(filter.path, '?entity', getPathId(filter.path));
                filterPaths.set(filter.path, parsed);
            }
        }

        for (const [path, parsed] of projectionPaths) {
            constructPatterns.push(...parsed.patterns);
        }

        for (const [path, parsed] of projectionPaths) {
            const hasFilter = filters.some(f => f.path === path);
            if (hasFilter) {
                wherePatterns.push(...parsed.patterns);
            } else {
                wherePatterns.push(`OPTIONAL { ${parsed.patterns.join(' ')} }`);
            }
        }

        for (const [path, parsed] of filterPaths) {
            wherePatterns.push(...parsed.patterns);
        }

        for (const filter of filters) {
            const parsed = projectionPaths.get(filter.path) || filterPaths.get(filter.path);
            if (!parsed) throw new Error(`Filter path '${filter.path}' not found`);
            const filterExpr = this.buildFilterExpression(
                parsed.finalVariable,
                filter.operator,
                filter.value
            );
            wherePatterns.push(filterExpr);
        }

        const sparqlQuery = `
            PREFIX textSearch: <https://qlever.cs.uni-freiburg.de/textSearch/>
            CONSTRUCT {
                ${constructPatterns.join('\n                ')}
            }
            WHERE {
                ${wherePatterns.join('\n                ')}
            }
            LIMIT ${limit}
        `;

        const quads = await this.queryService.executeConstructQuery(sparqlQuery, [this.sparqlEndpoint]);

        return {
            quads,
            count: quads.length,
            query: params,
        };
    }

    /**
     * Generate a human-readable description of the query
     */
    async generateDescription(params: QueryBuilderParams): Promise<string> {
        const { type, filters = [], project, limit } = params;

        const typeLabel = await resolveLabel(type, this.queryService, this.sparqlEndpoint);
        let description = `Query for **${typeLabel}** entities`;


        const projectLabels = await Promise.all(project.map(async (path) => {
            const segments = this.splitPropertyPath(path);
            const labels = await Promise.all(segments.map(async (segment) => {
                try {
                    const uri = resolvePropertyToUri(segment);
                    const cleanUri = uri.replace(/^<|>$/g, '');
                    return await resolveLabel(cleanUri, this.queryService, this.sparqlEndpoint);
                } catch {
                    return formatLocalName(segment);
                }
            }));
            return labels.join(' ---> ');
        }));

        description += ` showing ${projectLabels.map(label => `**${label}**`).join(' and ')} `;

        if (filters.length > 0) {
            const filterDescriptions = await Promise.all(filters.map(async (filter) => {
                const segments = this.splitPropertyPath(filter.path);
                const readablePath = await Promise.all(segments.map(async (segment) => {
                    try {
                        const uri = resolvePropertyToUri(segment);
                        const cleanUri = uri.replace(/^<|>$/g, '');
                        return await resolveLabel(cleanUri, this.queryService, this.sparqlEndpoint);
                    } catch {
                        return formatLocalName(segment);
                    }
                }));

                const pathDisplay = readablePath.join(' ---> ');
                const operatorText = this.operatorToText(filter.operator);

                // Clean up technical literal formatting (e.g., "2025"^^xsd:gYear -> 2025)
                let displayValue = filter.value;
                if (displayValue.startsWith('"') || displayValue.startsWith("'")) {
                    // Match "value" or "value"^^type or "value"@lang
                    const match = displayValue.match(/^["']([^"']+)["']/);
                    if (match) displayValue = match[1];
                } else if (displayValue.startsWith('<') && displayValue.endsWith('>')) {
                    const uri = displayValue.slice(1, -1);
                    displayValue = await resolveLabel(uri, this.queryService, this.sparqlEndpoint);
                }

                return `**${pathDisplay}** ${operatorText} **${displayValue}**`;
            }));
            description += ` where ${filterDescriptions.join(' AND ')}`;
        }

        if (limit && limit < 10000) {
            description += ` (Limited to ${limit} results)`;
        }

        return description;
    }

    /**
     * Convert operator to human-readable text
     */
    private operatorToText(operator: string): string {
        const mapping: { [key: string]: string } = {
            '=': 'is equal to',
            '!=': 'is not equal to',
            '>': 'is greater than',
            '<': 'is less than',
            '>=': 'is greater than or equal to',
            '<=': 'is less than or equal to',
            'search': 'matches',
            'contains': 'contains'
        };
        return mapping[operator] || operator;
    }
}
