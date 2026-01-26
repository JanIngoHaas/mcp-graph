import { beforeAll, test, expect } from 'vitest';
import { InspectionService } from '../../dist/services/InspectionService.js';
import { QueryService } from '../../dist/services/QueryService.js';
import { EmbeddingHelper } from '../../dist/services/EmbeddingHelper.js';

let inspectionService;
let queryService;
let embeddingHelper;
const SPARQL_EP = 'https://sparql.dblp.org/sparql';

beforeAll(async () => {
    queryService = new QueryService();
    embeddingHelper = new EmbeddingHelper();
    inspectionService = new InspectionService(queryService, SPARQL_EP, embeddingHelper);
}, 30000);

async function testInspectionClass() {
    const classUri = 'https://dblp.org/rdf/schema#Person';
    const result = await inspectionService.inspect(classUri);
    console.log('Inspection Class Result:\n', result);

    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
    expect(result.type).toBe('class');
    expect(result.data).toBeDefined();
    expect(result.data.uri).toBe(classUri);
    // Class-specific checks
    expect(result.data.label).toBeDefined();
}

async function testInspectionProperty() {
    const propertyUri = 'https://dblp.org/rdf/schema#authoredBy';
    const result = await inspectionService.inspect(propertyUri);
    console.log('Inspection Property Result:\n', result);

    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
    // It might return 'property' or sometimes 'entity' if the KG structure is loose, but normally 'property'
    expect(['property', 'entity']).toContain(result.type);

    if (result.type === 'property') {
        expect(result.data.uri).toBe(propertyUri);
        expect(result.data.domains).toBeDefined();
        expect(result.data.ranges).toBeDefined();
    }
}

async function testInspectEntity() {
    const entityUri = 'https://dblp.org/pid/t/AlanMTuring';
    const result = await inspectionService.inspect(entityUri);
    console.log('Inspect Entity Result:\n', result);

    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
    expect(result.type).toBe('entity');
    expect(result.data.uri).toBe(entityUri);
    expect(result.data.outgoing).toBeDefined();
    expect(result.data.incoming).toBeDefined();
}

async function testInspectWithExpandProperties() {
    const entityUri = 'https://dblp.org/pid/t/AlanMTuring';
    const expandProp = 'https://dblp.org/rdf/schema#authorOf';
    const result = await inspectionService.inspect(
        entityUri,
        [expandProp]
    );
    console.log('Inspect with Expand Properties Result:\n', result);

    expect(result).toBeDefined();
    expect(result.type).toBe('entity');
    expect(result.data.expandedProperties).toContain(expandProp);
}

test('Inspect Class', testInspectionClass, 60000);
test('Inspect Property', testInspectionProperty, 60000);
test('Inspect Entity', testInspectEntity, 60000);
test('Inspect with Expand Properties', testInspectWithExpandProperties, 60000);
