import { beforeAll, test, expect, beforeEach } from 'vitest';
import { QueryHelper } from '../../dist/services/QueryHelper.js';
import { SearchService } from '../../dist/services/SearchService.js';
import { EmbeddingHelper } from '../../dist/services/EmbeddingHelper.js';
import { DatabaseHelper } from '../../dist/services/DatabaseHelper.js';
import Logger from "../../dist/utils/logger.js";

let searchService;
let queryHelper;
let embeddingHelper;
let databaseHelper;

const SPARQL_EP = 'https://dbpedia.org/sparql';

beforeAll(async () => {
    queryHelper = new QueryHelper();
    embeddingHelper = new EmbeddingHelper();
    databaseHelper = new DatabaseHelper("./tmp-test/test.db");
    searchService = new SearchService(queryHelper, embeddingHelper, databaseHelper);
    await searchService.exploreOntology(SPARQL_EP, (processed, total) => {
        Logger.info(
            `Ontology exploration progress: ${processed} items${total ? ` of ${total}` : ""
            } processed`
        );
    });
}, 300000);


async function testSearchOntologyClasses() {

    const result = await searchService.searchOntology("person writer", "class", 10, SPARQL_EP);
    console.log('Search Classes Result:\n', result);
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
}

async function testSearchOntologyProperties() {
    // Exploration should already be done from previous test
    const result = await searchService.searchOntology("Birthday", "property", 20, SPARQL_EP);
    console.log('Search Properties Result:\n', result);
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
}

async function testSearchAll() {
    const result = await searchService.searchAll("Einstein", SPARQL_EP);
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
    console.log("Results Rendered:\n", searchService.renderResourceResult(result));
};

test('Search All', testSearchAll, 300000);
test('Search Ontology Classes', testSearchOntologyClasses, 300000);
test('Search Ontology Properties', testSearchOntologyProperties, 300000);