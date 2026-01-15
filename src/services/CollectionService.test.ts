import { describe, it, expect, beforeAll } from 'vitest';
import { CollectionService } from './CollectionService.js';
import { QueryService } from './QueryService.js';
import { QueryParserService, FallbackBackend } from '../utils/queryParser.js';

const SPARQL_EP = 'https://sparql.dblp.org/sparql';

describe('CollectionService Integration', () => {
    let collectionService: CollectionService;
    let queryService: QueryService;

    beforeAll(() => {
        queryService = new QueryService();
        collectionService = new CollectionService(
            queryService,
            SPARQL_EP,
            new QueryParserService(new FallbackBackend())
        );
    });

    it('should be defined', () => {
        expect(collectionService).toBeDefined();
    });

    describe('executeCollection', () => {
        it('should fetch Persons with their labels', async () => {
            // Fetch 5 random people and their labels
            const queryParams = {
                type: 'https://dblp.org/rdf/schema#Person',
                map: ['http://www.w3.org/2000/01/rdf-schema#label'],
                limit: 5
            };

            const result = await collectionService.executeCollection(queryParams);

            expect(result).toBeDefined();
            expect(result.query).toEqual(queryParams);
            // We expect some quads back
            expect(result.quads.length).toBeGreaterThan(0);
            expect(result.count).toBeGreaterThan(0);
        }, 30000);

        it('should filter Persons by name (SEARCH)', async () => {
            const queryParams = {
                type: 'https://dblp.org/rdf/schema#Person',
                map: ['http://www.w3.org/2000/01/rdf-schema#label'],
                filter: {
                    predicate: 'http://www.w3.org/2000/01/rdf-schema#label',
                    operator: 'search',
                    value: 'Knuth'
                },
                limit: 10
            };

            const result = await collectionService.executeCollection(queryParams);

            expect(result.quads.length).toBeGreaterThan(0);

            // Verify that at least one result actually contains "Knuth"
            const hasKnuth = result.quads.some(q =>
                q.predicate.value === 'http://www.w3.org/2000/01/rdf-schema#label' &&
                q.object.value.includes('Knuth')
            );
            expect(hasKnuth).toBe(true);
        }, 30000);

        it('should fetch Publications with years (verification of data)', async () => {
            const queryParams = {
                type: 'https://dblp.org/rdf/schema#Publication',
                map: ['https://dblp.org/rdf/schema#yearOfPublication'],
                limit: 5
            };

            const result = await collectionService.executeCollection(queryParams);

            expect(result.quads.length).toBeGreaterThan(0);

            // Verify we see years
            const hasYear = result.quads.some(q =>
                q.predicate.value === 'https://dblp.org/rdf/schema#yearOfPublication' &&
                !isNaN(parseInt(q.object.value))
            );
            expect(hasYear).toBe(true);
        }, 30000);

        it('should filter Persons by exact name (Equality)', async () => {
            const TARGET_NAME = 'Donald E. Knuth';
            const queryParams = {
                type: 'https://dblp.org/rdf/schema#Person',
                map: ['http://www.w3.org/2000/01/rdf-schema#label'],
                filter: {
                    predicate: 'http://www.w3.org/2000/01/rdf-schema#label',
                    operator: '=',
                    value: TARGET_NAME
                },
                limit: 5
            };

            const result = await collectionService.executeCollection(queryParams);

            expect(result.quads.length).toBeGreaterThan(0);

            // Check if we found him
            const found = result.quads.some(q =>
                q.predicate.value === 'http://www.w3.org/2000/01/rdf-schema#label' &&
                q.object.value === TARGET_NAME
            );
            expect(found).toBe(true);
        }, 30000);
    });

    describe('generateDescription (Integration)', () => {
        it('should resolve labels for description', async () => {
            const queryParams = {
                type: 'https://dblp.org/rdf/schema#Person',
                map: ['http://www.w3.org/2000/01/rdf-schema#label'],
                limit: 5
            };

            const description = await collectionService.generateDescription(queryParams);

            // "Person" might resolve to "Person" or a more specific label depending on the ontology
            // But it should definitely contain English words.
            expect(description.length).toBeGreaterThan(10);
            console.log('Generated Description:', description);
        }, 30000);
    });
});
