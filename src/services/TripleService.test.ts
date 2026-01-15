import { beforeAll, test, expect, describe } from 'vitest';
import { QueryService } from './QueryService.js';
import { TripleService } from './TripleService.js';

const SPARQL_EP = 'https://dbpedia.org/sparql';

describe('TripleService Integration Tests', () => {
    let queryService: QueryService;
    let tripleService: TripleService;

    beforeAll(() => {
        queryService = new QueryService();
        tripleService = new TripleService(queryService, SPARQL_EP);
    });

    test('completeTriple - find object (Einstein birthPlace)', async () => {
        // dbr:Albert_Einstein dbo:birthPlace ?o
        const s = 'http://dbpedia.org/resource/Albert_Einstein';
        const p = 'http://dbpedia.org/ontology/birthPlace';

        const result = await tripleService.completeTriple(s, p, "_");

        expect(result).toBeDefined();
        // Check if we found Ulm
        const foundUlm = result.some(q => q.object.value.includes('Ulm'));
        expect(foundUlm).toBe(true);
    }, 30000);

    test('completeTriple - find subject (Born in Ulm)', async () => {
        // ?s dbo:birthPlace dbr:Ulm
        const p = 'http://dbpedia.org/ontology/birthPlace';
        const o = 'http://dbpedia.org/resource/Ulm';

        const result = await tripleService.completeTriple("_", p, o, 5);

        expect(result).toBeDefined();
        // Check that we found Quads where object is Ulm
        const someUlm = result.some(q => q.object.value.includes('Ulm'));
        expect(someUlm).toBe(true);

        // Predicate should be birthPlace
        const correctPredicate = result.every(q => q.predicate.value === p);
        expect(correctPredicate).toBe(true);
    }, 30000);

    test('completeTriple - prefixes', async () => {
        const s = 'dbr:Albert_Einstein';
        const p = 'dbo:birthPlace';

        const result = await tripleService.completeTriple(s, p, "_");
        expect(result.length).toBeGreaterThan(0);
        const foundUlm = result.some(q => q.object.value.includes('Ulm'));
        expect(foundUlm).toBe(true);
    }, 30000);
});
