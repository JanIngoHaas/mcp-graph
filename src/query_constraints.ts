import { QueryEngine, QueryEngineFactory } from '@comunica/query-sparql';
import { IriTerm, Parser, Pattern, Triple, Variable } from 'sparqljs';
import { ExplorationService } from './exploration.js';

interface TypeBinding {
    value: string;
    type: 'variable' | 'iri';
}

// Simple type inference for cases 1) and 3):
// Case 1: ?s a ?type . ?s ?p ?o . -> directly infer type
// Case 3: ?s ?p ?o . BIND(?s AS ?s2) . ?s2 a ?type . -> handle BIND aliases
function inferTypes(patterns: Pattern[]): Map<string, TypeBinding> {
    const typings = new Map<string, TypeBinding>();
    const aliases = new Map<string, string>(); // Track BIND aliases: alias -> original
    
    // First pass: collect BIND aliases
    for (const pattern of patterns) {
        if (pattern.type === 'bind') {
            const aliasVar = String(pattern.variable);
            const originalVar = String(pattern.expression);
            aliases.set(aliasVar, originalVar);
        }
    }
    
    // Flatten alias chains using fixpoint iteration: aliasA -> aliasB -> ?a. IE Compute transitive closure
    let aliasChanged = true;
    while (aliasChanged) {
        aliasChanged = false;
        for (const [alias, target] of aliases.entries()) {
            const resolved = aliases.get(target);
            if (resolved && resolved !== target) {
                aliases.set(alias, resolved);
                aliasChanged = true;
            }
        }
    }
    
    // Second pass: collect type assertions
    for (const pattern of patterns) {
        if (pattern.type === 'bgp') {
            for (const triple of pattern.triples) {
                // Look for "subj a obj" patterns (rdf:type)
                const isTypeProperty = ('termType' in triple.predicate && 
                                      triple.predicate.termType === 'NamedNode' &&
                                      (triple.predicate.value === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' ||
                                       triple.predicate.value === 'a'));
                
                if (isTypeProperty) {
                    const subjStr = String(triple.subject);
                    
                    if (triple.object.termType === 'NamedNode') {
                        // Direct type assertion: ?s a <Type>
                        typings.set(subjStr, { value: triple.object.value, type: 'iri' });
                        
                        // Also apply to original variable if this is an alias
                        const originalVar = aliases.get(subjStr);
                        if (originalVar) {
                            typings.set(originalVar, { value: triple.object.value, type: 'iri' });
                        }
                    } else if (triple.object.termType === 'Variable') {
                        // Type variable: ?s a ?type (less common, but possible)
                        typings.set(subjStr, { value: String(triple.object), type: 'variable' });
                        
                        const originalVar = aliases.get(subjStr);
                        if (originalVar) {
                            typings.set(originalVar, { value: String(triple.object), type: 'variable' });
                        }
                    }
                }
            }
        }
    }
    
    // Only do fixpoint iteration if we have variable types (rare case)
    const hasVariableTypes = Array.from(typings.values()).some(binding => binding.type === 'variable');
    if (hasVariableTypes) {
        let changed = true;
        while (changed) {
            changed = false;
            for (const [key, binding] of typings.entries()) {
                if (binding.type === 'variable') {
                    const resolved = typings.get(binding.value);
                    if (resolved && resolved !== binding) {
                        typings.set(key, resolved);
                        changed = true;
                    }
                }
            }
        }
    }
    
    return typings;
}

async function checkPattern(pat: Pattern, expService: ExplorationService, typings: Map<string, TypeBinding>): Promise<string[]> {
    let db = await expService.getDatabase();
    
    // Whitelist of common metadata properties that bypass domain-range validation
    const whitelistedProperties = new Set([
        'http://www.w3.org/2000/01/rdf-schema#label',
        'http://www.w3.org/2000/01/rdf-schema#comment',
        'http://www.w3.org/2000/01/rdf-schema#type',
        'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
        'http://www.w3.org/2000/01/rdf-schema#subClassOf',
        'http://www.w3.org/2000/01/rdf-schema#subPropertyOf',
        'http://www.w3.org/2002/07/owl#sameAs',
        'http://www.w3.org/2004/02/skos/core#prefLabel',
        'http://www.w3.org/2004/02/skos/core#altLabel',
        'http://purl.org/dc/elements/1.1/title',
        'http://purl.org/dc/elements/1.1/description'
    ]);
    
    if (pat.type === 'bgp') {
        for (const triple of pat.triples) {
            // Check if the subject, predicate, and object are valid
            let givenProp = String(triple.predicate);
            let givenSubj = String(triple.subject);
            let givenObj = String(triple.object);

            // Skip validation for whitelisted properties
            if (whitelistedProperties.has(givenProp)) {
                continue;
            }
            
            // Check if property exists
            const propExists = !!db.prepare('SELECT 1 FROM domain_prop_range WHERE property_uri = ?').get(givenProp);
            if (!propExists) {
                return [`Specified triple pattern '${givenSubj} ${givenProp} ${givenObj}' has unknown property '${givenProp}' - Use only properties that have been explored. Search for properties first using the 'searchProperties' tool.`];
            }

            let subjErrors = [];
            let objErrors = [];

            // a) Subject validation
            const subjType = typings.get(givenSubj);
            if (subjType && subjType.type === 'iri') {
                // Subject is typed - validate against property domain
                const domainCheck = db.prepare('SELECT 1 FROM domain_prop_range WHERE property_uri = ? AND domain_uri = ?');
                const validDomain = !!domainCheck.get(givenProp, subjType.value);
                if (!validDomain) {
                    subjErrors.push(`Subject '${givenSubj}' of type '${subjType.value}' is not compatible with property '${givenProp}' domain`);
                }
            } else {
                // Subject is not typed - check if property has only one domain
                const domains = db.prepare('SELECT DISTINCT domain_uri FROM domain_prop_range WHERE property_uri = ?').all(givenProp);
                if (domains.length > 1) {
                    subjErrors.push(`Subject '${givenSubj}' must be typed - property '${givenProp}' has multiple possible domains`);
                }
            }

            // b) Object validation  
            const objType = typings.get(givenObj);
            if (objType && objType.type === 'iri') {
                // Object is typed - validate against property range
                const rangeCheck = db.prepare('SELECT 1 FROM domain_prop_range WHERE property_uri = ? AND range_uri = ?');
                const validRange = !!rangeCheck.get(givenProp, objType.value);
                if (!validRange) {
                    objErrors.push(`Object '${givenObj}' of type '${objType.value}' is not compatible with property '${givenProp}' range`);
                }
            } else {
                // Object is not typed - check if property has only one range
                const ranges = db.prepare('SELECT DISTINCT range_uri FROM domain_prop_range WHERE property_uri = ?').all(givenProp);
                if (ranges.length > 1) {
                    objErrors.push(`Object '${givenObj}' must be typed - property '${givenProp}' has multiple possible ranges`);
                }
            }

            // c) If both fail, check if switching would help
            if (subjErrors.length > 0 && objErrors.length > 0) {
                const switchCheck = db.prepare('SELECT 1 FROM domain_prop_range WHERE property_uri = ? AND domain_uri = ? AND range_uri = ?');
                const switchedType = objType && subjType ? switchCheck.get(givenProp, objType.value, subjType.value) : null;
                
                if (switchedType) {
                    return [`Triple pattern '${givenSubj} ${givenProp} ${givenObj}' has domain and range switched. Expected order is '${givenObj} ${givenProp} ${givenSubj}'.`];
                } else {
                    return [...subjErrors, ...objErrors];
                }
            }

            // Return individual errors if only one side fails
            if (subjErrors.length > 0) return subjErrors;
            if (objErrors.length > 0) return objErrors;
 
        }
    }
    else if (pat.type === 'optional' || pat.type === 'minus' || pat.type === 'union' || pat.type === 'graph' || pat.type === 'service') {
        // Check patterns inside OPTIONAL blocks
        let errors = [];
        for(const innerPattern of pat.patterns || []) {
            const error = await checkPattern(innerPattern, expService, typings);
            if (error) {
                errors.push(error);
            }
        }
        return errors.flat();
    }
    else if (pat.type === 'filter' || pat.type === 'bind' || pat.type === 'values') {
        // Dont' care here...
    }
    return [];
}

/*


Cases:
1) 
?s a ?type .
?s ?p ?o . 

- ?s is _typed_. Check if correct domain and range.

2) 
... Does above pattern work recursively too? NOt sure (see below...)

3) 
?s ?p ?o .
BIND(?s AS ?s2) .
?s2 a ?type .

---> Here: ?s and ?s2 refer to the same subject, i.e. basically an alias. 
Collect all into equivalence classes.

2) (For later, after more testing...)
We could have something like:

?p2 a ?type .
?s ?t ?p2 .
?s ?p ?o .

- ?s is _untyped_. The relation of s with p2 over t is not enough to infer the type of s. 
=> Error: Force the model to type ?s 

---- 
What else?

*/


export async function checkQueryConstraints(query: string, explorationService: ExplorationService): Promise<string> {

    // 1) Parse the query
    let parser = new Parser({});
    let pq = parser.parse(query);

    if (pq.type == "query") {
        // First pass: type inference
        const typings = inferTypes(pq.where || []);
        
        // Second pass: constraint checking
        let errors = [];
        for (const pattern of pq.where || []) {
            // Check each pattern in the WHERE clause
            const error = await checkPattern(pattern, explorationService, typings);
            if (error) {
                errors.push(error);
            }
        }

        let out = "Error in SPARQL query:\n";
        let idx = 1;
        errors = errors.flat();
        if (errors.length > 0) {
            for(const error of errors) {
                out += `${idx++}. ${error}\n\n`;
            }
        }
        return out;
        
    } else if (pq.type == "update") {
        return "SPARQL UPDATE queries are not allowed.";
    } 

    return "";
}