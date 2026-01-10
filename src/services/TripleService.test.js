import { beforeAll, test, expect, describe } from 'vitest';
import { QueryService } from '../../dist/services/QueryService.js';
import { TripleService } from '../../dist/services/TripleService.js';

const SPARQL_EP = 'https://dbpedia.org/sparql';

let queryService;
let tripleService;

beforeAll(() => {
    queryService = new QueryService();
    tripleService = new TripleService(queryService, SPARQL_EP);
});

describe('TripleService Integration Tests', () => {
    test('completeTriple - find object (Einstein birthPlace)', async () => {
        // dbr:Albert_Einstein dbo:birthPlace ?o
        const s = 'http://dbpedia.org/resource/Albert_Einstein';
        const p = 'http://dbpedia.org/ontology/birthPlace';

        const result = await tripleService.completeTriple(s, p, "_");
        console.log("Result (Find Object):", result);

        expect(result).toBeDefined();
        expect(result).toContain('Ulm');
        // Check for table
        expect(result).toContain('| Subject | Predicate | Object |');
    }, 30000);

    test('completeTriple - find subject (Born in Ulm)', async () => {
        // ?s dbo:birthPlace dbr:Ulm
        const p = 'http://dbpedia.org/ontology/birthPlace';
        const o = 'http://dbpedia.org/resource/Ulm';

        const result = await tripleService.completeTriple("_", p, o, 5);

        expect(result).toBeDefined();
        // Check that we found some subjects pointing to Ulm
        expect(result).toContain('dbr:Ulm');
        expect(result).toContain('dbo:birthPlace');
        // We can't guarantee Albert Einstein is in the first 5 results from DBpedia
    }, 30000);

    test('completeTriple - prefixes', async () => {
        // Test passing prefixed string directly if the service allows (depending on logic in service vs handler)
        // The service has `completeTriple(subject, ...)` where subject is string.
        // It wraps in <...> if http, or keeps as is if ':' present.

        const s = 'dbr:Albert_Einstein';
        const p = 'dbo:birthPlace';

        // This relies on the endpoint accepting prefixes OR the service handling them via PrefixManager queries? 
        // Wait, executeConstructQuery logic: 
        // 1. TripleService formats the triple pattern. 
        // 2. QueryService adds prefixes to the query via `prefixManager.addPrefixesToQuery`.
        // So passing 'dbr:...' should work because the PREFIX dbr: ... will be added to the start of the query.

        const result = await tripleService.completeTriple(s, p, "_");
        expect(result).toContain('Ulm');
    }, 30000);
});
