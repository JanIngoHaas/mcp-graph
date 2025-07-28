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

async function testInspectMetadataProp() {
    const metadata = await inspectionService.inspectMetadata('http://dbpedia.org/ontology/author', SPARQL_EP);
    console.log('Inspect Metadata Result:\n', metadata);
}

async function testInspectMetadataClass() {
    const metadata = await inspectionService.inspectMetadata('http://dbpedia.org/ontology/Animal', SPARQL_EP);
    console.log('Inspect Metadata Class Result:\n', metadata);
    expect(metadata).toBeDefined();
}

async function testInspectDataCaesar() {
    const caesarUri = 'http://dbpedia.org/resource/Julius_Caesar';
    const result = await inspectionService.inspectData(caesarUri, SPARQL_EP, ["http://xmlns.com/foaf/0.1/depiction"]);
    console.log('Inspect Data Caesar Result:\n', result);
    expect(result).toBeDefined();
    expect(result.includes('Outgoing Properties')).toBeTruthy();
    expect(result.includes('Incoming Properties')).toBeTruthy();
    expect(result.includes('http://commons.wikimedia.org/wiki/Special:FilePath/Venus_and_Cupid_from_the_House_of_Marcus_Fabius_Rufus_at_Pompeii,_most_likely_a_depiction_of_Cleopatra_VII.jpg (URI)')).toBeTruthy();
}

test('Inspect Class', testInspectionClass, 300000);
test('Inspect Property', testInspectionProperty, 300000);
test('Inspect Metadata Property', testInspectMetadataProp, 300000);
test('Inspect Metadata Class', testInspectMetadataClass, 300000);
test('Inspect Data Caesar', testInspectDataCaesar, 300000);
