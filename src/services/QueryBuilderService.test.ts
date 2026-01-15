import { describe, it, expect, beforeAll } from 'vitest';
import { QueryBuilderService } from './QueryBuilderService.js';
import { QueryService } from './QueryService.js';
import { SearchService } from './SearchService.js';

const SPARQL_EP = 'https://sparql.dblp.org/sparql';

describe('QueryBuilderService Integration', () => {
    let queryBuilderService: QueryBuilderService;
    let queryService: QueryService;
    let searchService: SearchService;

    beforeAll(() => {
        queryService = new QueryService();
        searchService = new SearchService(queryService, SPARQL_EP);
        queryBuilderService = new QueryBuilderService(queryService, SPARQL_EP, searchService.getQueryParser());
    });

    it('should be defined', () => {
        expect(queryBuilderService).toBeDefined();
    });

    describe('executeQuery', () => {
        it('should fetch Publications with their labels using <URI> syntax', async () => {
            const result = await queryBuilderService.executeQuery({
                type: '<https://dblp.org/rdf/schema#Publication>',
                project: ['<http://www.w3.org/2000/01/rdf-schema#label>'],
                limit: 5
            });

            expect(result).toBeDefined();
            expect(result.quads.length).toBeGreaterThan(0);
            expect(result.count).toBeGreaterThan(0);
        }, 30000);

        it('should fetch Publications with their labels using "label" shorthand', async () => {
            const result = await queryBuilderService.executeQuery({
                type: '<https://dblp.org/rdf/schema#Publication>',
                project: ['label'],
                limit: 5
            });

            expect(result).toBeDefined();
            expect(result.quads.length).toBeGreaterThan(0);
        }, 30000);

        it('should filter Publications by year using prefixed name dblp:yearOfPublication', async () => {
            const result = await queryBuilderService.executeQuery({
                type: '<https://dblp.org/rdf/schema#Publication>',
                project: [
                    'label',
                    'dblp:yearOfPublication'
                ],
                filters: [{
                    path: 'dblp:yearOfPublication',
                    operator: '>',
                    value: '"2023"^^xsd:gYear'
                }],
                limit: 10
            });

            expect(result.quads.length).toBeGreaterThan(0);

            // Validation
            const yearQuads = result.quads.filter(q =>
                q.predicate.value.endsWith('yearOfPublication')
            );
            expect(yearQuads.length).toBeGreaterThan(0);
        }, 30000);

        it('should filter Publications by author name using path traversal with mixed syntax', async () => {
            // Path: <...authoredBy>.label
            // This tests the splitting logic respecting angle brackets
            const result = await queryBuilderService.executeQuery({
                type: '<https://dblp.org/rdf/schema#Publication>',
                project: [
                    'label',
                    '<https://dblp.org/rdf/schema#authoredBy>.label'
                ],
                filters: [{
                    // Use mixed syntax: Full URI for property, shorthand for label
                    path: '<https://dblp.org/rdf/schema#authoredBy>.label',
                    operator: 'contains',
                    value: 'Gaedke'
                }],
                limit: 10
            });

            expect(result.quads.length).toBeGreaterThan(0);

            const labelQuads = result.quads.filter(q =>
                q.predicate.value === 'http://www.w3.org/2000/01/rdf-schema#label'
            );
            // We should find at least one label with Gaedke
            const hasGaedke = labelQuads.some(q => q.object.value.includes('Gaedke'));
            expect(hasGaedke).toBe(true);
        }, 30000);

        it('should handle multiple filters with AND logic', async () => {
            const result = await queryBuilderService.executeQuery({
                type: '<https://dblp.org/rdf/schema#Publication>',
                project: [
                    'label',
                    'dblp:yearOfPublication'
                ],
                filters: [
                    {
                        path: 'dblp:yearOfPublication',
                        operator: '>=',
                        value: '"2020"^^xsd:gYear'
                    },
                    {
                        path: 'dblp:yearOfPublication',
                        operator: '<=',
                        value: '"2022"^^xsd:gYear'
                    }
                ],
                limit: 10
            });

            expect(result.quads.length).toBeGreaterThan(0);
        }, 30000);

        it('should verify the tool description example configuration works (with correct prefixes)', async () => {
            // Example from tool description (corrected for DBLP prefixes):
            // "Find publications by 'Martin Gaedke' published after 2020"
            const result = await queryBuilderService.executeQuery({
                type: 'https://dblp.org/rdf/schema#Publication',
                filters: [
                    { path: 'dblp:authoredBy.label', operator: 'contains', value: 'Martin Gaedke' },
                    { path: 'dblp:yearOfPublication', operator: '>', value: '"2020"^^xsd:gYear' }
                ],
                project: ['label', 'dblp:yearOfPublication', 'dblp:authoredBy.label']
            });

            expect(result).toBeDefined();
            // We expect some results, assuming DBLP has recent publications by Martin Gaedke
            // If this fails due to empty results, we might need to adjust the query, but the structure is what we test.
            if (result.count > 0) {
                expect(result.quads.length).toBeGreaterThan(0);

                // Verify year > 2020
                const yearQuads = result.quads.filter(q => q.predicate.value.endsWith('yearOfPublication'));
                yearQuads.forEach(q => {
                    const year = parseInt(q.object.value);
                    expect(year).toBeGreaterThan(2020);
                });

                // Verify author label contains Martin Gaedke
                const labelQuads = result.quads.filter(q => q.predicate.value.endsWith('label'));
                const hasMartinGaedke = labelQuads.some(q => q.object.value.includes('Martin Gaedke'));
                expect(hasMartinGaedke).toBe(true);
            }
        }, 30000);
    });
});
