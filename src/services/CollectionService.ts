import { QueryService } from "./QueryService.js";
import { PrefixManager } from "../utils/PrefixManager.js";
import { resolveLabel, formatSparqlValue } from "../utils/formatting.js";
import { Quad } from "@rdfjs/types";
import { QueryParserService, FallbackBackend } from "../utils/queryParser.js";

/**
 * Filter condition for collection queries
 */
export interface FilterCondition {
    predicate: string;
    operator: string;
    value: string;
}

/**
 * Result row from a collection query
 */
export interface CollectionRow {
    [key: string]: string;
}

/**
 * Collection query result
 */
export interface CollectionResult {
    quads: Quad[];
    count: number;
    query: CollectionQuery;
}

/**
 * Collection query parameters
 */
export interface CollectionQuery {
    type: string;
    filter?: FilterCondition;
    map: string[];
    limit?: number;
}

export class CollectionService {

    constructor(
        private queryService: QueryService,
        private sparqlEndpoint: string,
        private queryParser: QueryParserService
    ) { }

    /**
     * Map SPARQL operator to human-readable text
     */
    private operatorToText(operator: string): string {
        const mapping: { [key: string]: string } = {
            '>': 'is greater than',
            '<': 'is less than',
            '>=': 'is greater than or equal to',
            '<=': 'is less than or equal to',
            '=': 'is equal to',
            '!=': 'is not equal to',
            'search': 'matches search query',
        };
        return mapping[operator.toLowerCase()] || operator;
    }

    /**
     * Build a SPARQL filter expression
     */
    private buildFilterExpression(condition: FilterCondition, variable: string): string {
        const { operator, value } = condition;
        const comparisonType = operator.toLowerCase();

        // Handle text search operators using QueryParser
        if (comparisonType === 'search') {
            return this.queryParser.parseAndGeneratePattern(value, variable);
        }

        // Handle numeric/comparison operators
        switch (comparisonType) {
            case '>':
            case '<':
            case '>=':
            case '<=':
            case '=':
            case '!=':
                // Numeric or direct comparison
                // Try to parse as number, otherwise treat as literal
                const numValue = parseFloat(value);
                if (!isNaN(numValue)) {
                    return `FILTER(${variable} ${operator} ${numValue})`;
                } else {
                    return `FILTER(${variable} ${operator} "${value}")`;
                }

            default:
                throw new Error(`Unsupported operator: ${operator}`);
        }
    }

    /**
     * Execute a collection query
     */
    async executeCollection(queryParams: CollectionQuery): Promise<CollectionResult> {
        const { type, filter, map, limit = 1000 } = queryParams;

        // Validate inputs
        if (!type) {
            throw new Error("Type parameter is required");
        }
        if (!map || map.length === 0) {
            throw new Error("Map parameter is required and must contain at least one predicate");
        }

        // Build CONSTRUCT query
        let constructTemplate: string[] = [];
        let whereClauses: string[] = [];

        // Add type constraint
        const formattedType = formatSparqlValue(type);
        constructTemplate.push(`?entity a ${formattedType} .`);
        whereClauses.push(`?entity a ${formattedType} .`);

        // Add map predicates
        map.forEach((predicate, idx) => {
            const varName = `?val${idx}`;
            const formattedPredicate = formatSparqlValue(predicate);
            constructTemplate.push(`?entity ${formattedPredicate} ${varName} .`);
            whereClauses.push(`OPTIONAL { ?entity ${formattedPredicate} ${varName} . }`);
        });

        // Add filter if present
        if (filter) {
            const filterVarIdx = map.indexOf(filter.predicate);
            const formattedFilterPredicate = formatSparqlValue(filter.predicate);

            let filterExpr: string;

            if (filterVarIdx === -1) {
                // Filter predicate not in map, add it temporarily
                const filterVar = `?filterVal`;
                whereClauses.push(`?entity ${formattedFilterPredicate} ${filterVar} .`);
                filterExpr = this.buildFilterExpression(filter, filterVar);
            } else {
                // Filter predicate is in map
                const filterVar = `?val${filterVarIdx}`;
                filterExpr = this.buildFilterExpression(filter, filterVar);
            }

            whereClauses.push(filterExpr);
        }

        const sparqlQuery = `
            PREFIX textSearch: <https://qlever.cs.uni-freiburg.de/textSearch/>
            CONSTRUCT {
                ${constructTemplate.join('\n                ')}
            }
            WHERE {
                ${whereClauses.join('\n                ')}
            }
            LIMIT ${limit}
        `;

        // Execute query
        const quads = await this.queryService.executeConstructQuery(sparqlQuery, [this.sparqlEndpoint]);

        return {
            quads,
            count: quads.length,
            query: queryParams,
        };
    }

    /**
     * Generate a human-readable description of the collection query
     */
    async generateDescription(queryParams: CollectionQuery): Promise<string> {
        const { type, filter, map } = queryParams;

        const typeLabel = await resolveLabel(type, this.queryService, this.sparqlEndpoint);
        let description = `The table below shows all '${typeLabel}' instances`;

        if (filter) {
            const predicateLabel = await resolveLabel(filter.predicate, this.queryService, this.sparqlEndpoint);
            const operatorText = this.operatorToText(filter.operator);
            description += ` where '${predicateLabel}' ${operatorText} '${filter.value}'`;
        }

        const columnLabels = await Promise.all(
            map.map(async (predicate) => await resolveLabel(predicate, this.queryService, this.sparqlEndpoint))
        );

        description += `, displaying ${columnLabels.map(label => `'${label}'`).join(', ')}.`;

        return description;
    }
}
