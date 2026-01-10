import { QueryService } from "./QueryService.js";
import { PrefixManager } from "../utils/PrefixManager.js";

export class TripleService {
    constructor(private queryService: QueryService, private sparqlEndpoint: string) { }

    public async completeTriple(
        subject: string,
        predicate: string,
        object: string,
        limit: number = 50
    ): Promise<string> {
        // Validation: Allow 0, 1, or 2 wildcards (reject only 3 wildcards)
        const wildcards = [subject, predicate, object].filter(arg => arg === "_").length;
        if (wildcards === 3) {
            throw new Error("Invalid Triple Pattern: You cannot use wildcards for all three components. Specify at least one known value.");
        }

        const formatValue = (val: string, variable: string) => {
            if (val === "_") return variable;

            // Strict URI Validation
            if (val.startsWith("http://") || val.startsWith("https://")) {
                return `<${val}>`;
            }
            if (val.includes(":")) {
                // Assume it's a prefixed name (e.g., dbr:Thing)
                return val;
            }

            // If we reach here, it's a plain string which we do NOT allow as input.
            // Users must provide URIs or Prefixed Names. 
            // Literals are only valid as *Outputs* discovered by the wildcard.
            throw new Error(`Invalid Input for ${variable}: '${val}'. You must provide a valid URI (starting with http) or a Prefixed Name (e.g., dbr:Einstein). Plain literals are not allowed as input criteria.`);
        };

        const s = formatValue(subject, "?s");
        const p = formatValue(predicate, "?p");
        const o = formatValue(object, "?o");

        const query = `
      CONSTRUCT { ${s} ${p} ${o} }
      WHERE { ${s} ${p} ${o} }
      LIMIT ${limit}
    `;

        const quads = await this.queryService.executeConstructQuery(query, [this.sparqlEndpoint]);

        if (quads.length === 0) {
            return "No matching triples found.";
        }

        let response = `## Found ${quads.length} triples\n\n`;
        response += "| Subject | Predicate | Object |\n";
        response += "|---------|-----------|--------|\n";

        quads.forEach((quad) => {
            const escapedS = quad.subject.replace(/\|/g, "\\|");
            const escapedP = quad.predicate.replace(/\|/g, "\\|");
            const escapedO = quad.object.replace(/\|/g, "\\|");
            response += `| ${escapedS} | ${escapedP} | ${escapedO} |\n`;
        });

        const prefixManager = PrefixManager.getInstance();
        return prefixManager.compressTextWithPrefixes(response);
    }
}
