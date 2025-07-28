import { beforeAll, test, expect } from 'vitest';
import { InspectionService } from '../../dist/services/InspectionService.js';
import { QueryService } from '../../dist/services/QueryService.js';

let inspectionService;
let queryHelper;
const SPARQL_EP = 'https://dbpedia.org/sparql';

beforeAll(() => {
    queryHelper = new QueryService();
    inspectionService = new InspectionService(queryHelper);
});

async function testInspectionClass() {
    const classUri = 'http://dbpedia.org/ontology/Person';
    const result = await inspectionService.inspectMetadata(classUri, SPARQL_EP);
    console.log('Inspection Class Result:\n', result);
    expect(result).toBeDefined();
    expect(result.includes("secondLeader")).toBeTruthy();
    expect(result.includes("voice")).toBeTruthy();
    expect(result.includes("birthPlace")).toBeTruthy();
    expect(result.includes("birthDate")).toBeTruthy();
    expect(result.includes("signature")).toBeTruthy();
    expect(result.includes("worldTournament")).toBeTruthy();
}

async function testInspectionProperty() {
    const propertyUri = 'http://dbpedia.org/ontology/birthPlace';
    const result = await inspectionService.inspectMetadata(propertyUri, SPARQL_EP);
    console.log('Inspection Property Result:\n', result);
    expect(result).toBeDefined();
}

test('Inspect Class', testInspectionClass, 300000);
test('Inspect Property', testInspectionProperty, 300000);