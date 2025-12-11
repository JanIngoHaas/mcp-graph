import { beforeAll, test, expect } from 'vitest';
import { QueryService } from '../../dist/services/QueryService.js';
import { PathExplorationService } from '../../dist/services/PathExplorationService.js';
import { EmbeddingHelper } from '../../dist/services/EmbeddingHelper.js';

let queryService;
let pathExplorationService;
let embeddingHelper;

const SPARQL_EP = 'https://dbpedia.org/sparql';

beforeAll(async () => {
    queryService = new QueryService();
    embeddingHelper = new EmbeddingHelper();
    pathExplorationService = new PathExplorationService(queryService, embeddingHelper);
}, 30000);

async function testBasicPathExploration() {
    console.log("Testing basic path exploration...");
    
    // Test with known DBpedia entities that should have connections - using simpler case
    const sourceUri = 'http://dbpedia.org/resource/Steve_Jobs';
    const targetUri = 'http://dbpedia.org/resource/Apple_Inc.';
    
    try {
        const result = await pathExplorationService.explore(sourceUri, targetUri, SPARQL_EP, "business relationships", 10, 2);
        
        expect(result).toBeDefined();
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
        
        // Should contain tree structure elements
        expect(result).toContain('Path Tree:');
        expect(result).toContain('Showing');
        expect(result).toContain('paths');
        
        console.log("Path exploration result:");
        console.log(result);
        
    } catch (error) {
        console.error("Path exploration test failed:", error);
        throw error;
    }
}

async function testNoPathsFound() {
    console.log("Testing no paths scenario...");
    
    // Test with entities that likely have no connection
    const sourceUri = 'http://dbpedia.org/resource/Fictional_Entity_12345';
    const targetUri = 'http://dbpedia.org/resource/Another_Fictional_Entity_67890';
    
    try {
        const result = await pathExplorationService.explore(sourceUri, targetUri, SPARQL_EP, "business relationships", 10, 2);
        
        expect(result).toBeDefined();
        expect(typeof result).toBe('string');
        expect(result).toContain('No paths found');
        
        console.log("No paths result:", result);
        
    } catch (error) {
        console.error("No paths test failed:", error);
        throw error;
    }
}

async function testShortPath() {
    console.log("Testing direct connection...");
    
    // Test entities that should have a direct connection
    const sourceUri = 'http://dbpedia.org/resource/Barack_Obama';
    const targetUri = 'http://dbpedia.org/resource/United_States';
    
    try {
        const result = await pathExplorationService.explore(sourceUri, targetUri, SPARQL_EP, "occupation", 100, 2);
        
        expect(result).toBeDefined();
        expect(typeof result).toBe('string');
        
        console.log("Short path result:");
        console.log(result);
        
    } catch (error) {
        console.error("Short path test failed:", error);
        throw error;
    }
}

// Main test runner
test('PathExplorationService basic functionality', async () => {
    await testBasicPathExploration();
}, 600000);

test('PathExplorationService no paths scenario', async () => {
    await testNoPathsFound();
}, 300000);

test('PathExplorationService short path', async () => {
    await testShortPath();
}, 300000);