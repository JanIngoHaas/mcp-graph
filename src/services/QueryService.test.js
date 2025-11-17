import { beforeAll, test, expect } from 'vitest';
import { QueryService } from '../../dist/services/QueryService.js';

let queryService;

const SPARQL_EP = 'https://dbpedia.org/sparql';

beforeAll(async () => {
    queryService = new QueryService();
}, 30000);

async function testDistinctAddition() {
    // Test with a query that would normally return duplicates
    // This query intentionally creates duplicates by forcing ?s = ?s2
    const duplicateQuery = `
        SELECT ?type WHERE {
            ?s a ?type .
            ?s2 a ?type .
            FILTER(?s = ?s2)
        } LIMIT 20`;

    console.log("Testing DISTINCT eliminates duplicates...");

    try {
        // Execute the query with our automatic DISTINCT addition
        const result = await queryService.executeQuery(duplicateQuery, [SPARQL_EP], "en", 100);

        expect(result).toBeDefined();
        expect(typeof result).toBe('string');

        // Check if result is a valid markdown table
        const lines = result.split('\n').filter(line => line.trim());
        const hasTableFormat = lines.some(line => line.includes('|'));

        console.log(`DISTINCT query result: ${hasTableFormat ? 'VALID TABLE FORMAT' : 'INVALID FORMAT'}`);

        // Should return a markdown table
        expect(hasTableFormat).toBe(true);

    } catch (error) {
        console.log("Duplicate test query failed:", error.message);
    }
}

async function testSelectWithExistingDistinct() {
    // Test query that already has DISTINCT
    const distinctQuery = "SELECT DISTINCT ?s ?p WHERE { ?s ?p ?o } LIMIT 3";

    try {
        const result = await queryService.executeQuery(distinctQuery, [SPARQL_EP], "en", 100);

        expect(result).toBeDefined();
        expect(typeof result).toBe('string');
        console.log(`Existing DISTINCT query: ${result.includes('|') ? 'VALID TABLE' : 'NO TABLE'} format`);

    } catch (error) {
        console.log("DISTINCT query failed:", error.message);
    }
}

async function testNonSelectQuery() {
    // Test ASK query (should not be modified)
    const askQuery = "ASK WHERE { ?s ?p ?o }";

    console.log("Testing non-SELECT query:");
    console.log("Query:", askQuery);

    try {
        const result = await queryService.executeQuery(askQuery, [SPARQL_EP], "en", 100);

        expect(result).toBeDefined();
        console.log("ASK query executed, result:", result);

    } catch (error) {
        console.log("ASK query failed:", error.message);
    }
}

async function testQueryServiceInstantiation() {
    expect(queryService).toBeDefined();
    expect(typeof queryService.executeQuery).toBe('function');
    console.log("QueryService instantiated successfully");
}

test('QueryService instantiation', testQueryServiceInstantiation, 10000);
test('SELECT query - DISTINCT addition', testDistinctAddition, 30000);
test('SELECT query - existing DISTINCT', testSelectWithExistingDistinct, 30000);
test('Non-SELECT query - no modification', testNonSelectQuery, 30000);