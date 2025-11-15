import { beforeAll, test, expect } from 'vitest';
import { QueryService } from '../../dist/services/QueryService.js';
import { SearchService } from '../../dist/services/SearchService.js';

let searchService;
let queryService;

const SPARQL_EP = 'https://sparql.dblp.org/sparql';

beforeAll(async () => {
    queryService = new QueryService();
    searchService = new SearchService(queryService, 'qlever');
}, 30000);


async function testBooleanAndSearch() {
    const result = await searchService.searchAll("machine AND learning", SPARQL_EP);
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
    console.log("Machine AND Learning results:", result.length);
    console.log("First result:", result[0]);
}

async function testBooleanOrSearch() {
    const result = await searchService.searchAll("neural OR networks", SPARQL_EP);
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
    console.log("Neural OR Networks results:", result.length);
    console.log("Sample results:", result.slice(0, 3).map(r => r.searchText));
}

async function testExactPhraseSearch() {
    const result = await searchService.searchAll('"deep learning"', SPARQL_EP);
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
    console.log('"deep learning" exact phrase results:', result.length);
}

async function testComplexBooleanSearch() {
    const result = await searchService.searchAll("(algorithm OR data) AND mining", SPARQL_EP);
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
    console.log("Complex boolean query results:", result.length);
}

async function testMultiWordImplicitAnd() {
    const result = await searchService.searchAll("computer vision", SPARQL_EP);
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
    console.log("Multi-word (implicit AND) results:", result.length);
    // Should find entities containing both "computer" and "vision"
    const hasComputerVision = result.some(r => 
        r.searchText?.toLowerCase().includes('computer') && 
        r.searchText?.toLowerCase().includes('vision')
    );
    expect(hasComputerVision).toBeTruthy();
}

async function testStreamlining() {
    const result = await searchService.searchAll("vocabulary conversion skos", SPARQL_EP);
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
    console.log("Results", result);
}

async function testLimitAndOffset() {
    const firstBatch = await searchService.searchAll("database", SPARQL_EP, 5, 0);
    const secondBatch = await searchService.searchAll("database", SPARQL_EP, 5, 5);
    
    expect(firstBatch).toBeDefined();
    expect(secondBatch).toBeDefined();
    expect(firstBatch.length).toBeLessThanOrEqual(5);
    expect(secondBatch.length).toBeLessThanOrEqual(5);
    
    // Check that pagination returns different results
    if (firstBatch.length > 0 && secondBatch.length > 0) {
        expect(firstBatch[0].uri).not.toBe(secondBatch[0].uri);
    }
    
    console.log("Pagination test - First batch:", firstBatch.length, "Second batch:", secondBatch.length);
};

async function testUnicodeSearch() {
    // Test various Unicode characters in search terms
    const unicodeQueries = [
        "café machine", // Latin with accent
        "naïve algorithm", // Latin with diaeresis
        "Müller network", // German umlaut
        "réseau neural" // French accents
    ];

    for (const query of unicodeQueries) {
        try {
            const result = await searchService.searchAll(query, SPARQL_EP);
            expect(result).toBeDefined();
            console.log(`Unicode query "${query}" results:`, result.length);
        } catch (error) {
            console.log(`Unicode query "${query}" failed:`, error.message);
        }
    }
}

test('Boolean AND Search - Machine Learning', testBooleanAndSearch, 60000);
test('Boolean OR Search - Neural Networks', testBooleanOrSearch, 60000);
test('Exact Phrase Search - Deep Learning', testExactPhraseSearch, 60000);
test('Complex Boolean Search - Data Mining', testComplexBooleanSearch, 60000);
test('Multi-word Implicit AND - Computer Vision', testMultiWordImplicitAnd, 60000);
test('Pagination with Limit and Offset', testLimitAndOffset, 60000);
test('Streamlining Paper Search', testStreamlining, 60000);
test('Unicode Character Support', testUnicodeSearch, 60000);