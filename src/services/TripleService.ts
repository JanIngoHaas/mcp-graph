import { QueryService } from "./QueryService.js";
import { PrefixManager } from "../utils/PrefixManager.js";
import { Quad } from "@rdfjs/types";
import { formatSparqlValue } from "../utils/uriUtils.js";

export class TripleService {
    constructor(private queryService: QueryService, private sparqlEndpoint: string) { }

    public async completeTriple(
        subject: string,
        predicate: string,
        object: string,
        limit: number = 50
    ): Promise<Quad[]> {
        // Validation: Allow 0, 1, or 2 wildcards (reject only 3 wildcards)
        const wildcards = [subject, predicate, object].filter(arg => arg === "_").length;
        if (wildcards === 3) {
            throw new Error("Invalid Triple Pattern: You cannot use wildcards for all three components. Specify at least one known value.");
        }

        const formatValueInput = (val: string, variable: string, isObject: boolean = false) => {
            if (val === "_") return variable;

            try {
                return formatSparqlValue(val);
            } catch (e) {
                if (isObject) {
                    // It's not a URI/Prefixed Name, so treat it as a literal
                    // Check if it's already a properly formatted literal (quoted, typed, or lang-tagged)
                    if (/^".*"(?:\^\^.*|@.*)?$/.test(val)) {
                        return val;
                    }
                    // Otherwise, wrap in quotes to make it a plain literal
                    return `"${val}"`;
                }
                throw new Error(`Invalid Input for ${variable}: '${val}'. You must provide a valid URI (starting with http) or a Prefixed Name (e.g., dbr:Einstein). Plain literals are not allowed as input criteria.`);
            }
        };

        const s = formatValueInput(subject, "?s");
        const p = formatValueInput(predicate, "?p");
        const o = formatValueInput(object, "?o", true);

        const query = `
      CONSTRUCT { ${s} ${p} ${o} }
      WHERE { ${s} ${p} ${o} }
      LIMIT ${limit}
    `;

        const quads = await this.queryService.executeConstructQuery(query, [this.sparqlEndpoint]);

        if (quads.length === 0) {
            return [];
        }

        return quads;
    }
}
