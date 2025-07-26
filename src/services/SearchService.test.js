import { QueryHelper } from '../../dist/services/QueryHelper.js';
import { SearchService } from '../../dist/services/SearchService.js';
import { EmbeddingHelper } from '../../dist/services/EmbeddingHelper.js';
import { DatabaseHelper } from '../../dist/services/DatabaseHelper.js';

let searchService;
let queryHelper;
let embeddingHelper;
let databaseHelper;

const SPARQL_EP = 'https://dbpedia.org/sparql';

beforeAll(() => {
    queryHelper = new QueryHelper();
    embeddingHelper = new EmbeddingHelper();
    databaseHelper = new DatabaseHelper("./tmp-test/test.db");
    searchService = new SearchService(queryHelper, embeddingHelper, databaseHelper);
});

async function testSearchOntology() {
    await searchService.exploreOntology(SPARQL_EP, { includeLabels: true, includeDescriptions: true });
    const result = await searchService.searchOntology("books author", SPARQL_EP);
    console.log('Search Ontology Result:\n', result);
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
}

async function testSearchAll() {
    const result = await searchService.searchAll("Einstein", SPARQL_EP);
    console.log('Search All Result:\n', result);
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
};

test('Search All', testSearchAll, 300000);

// BUG: https://backend.cafe/should-you-use-jest-as-a-testing-library
// test('Search Ontology', testSearchOntology, 300000);