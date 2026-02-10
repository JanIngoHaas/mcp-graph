import { QueryService } from "./QueryService.js";
import { PrefixManager } from "../utils/PrefixManager.js";
import { Quad } from "@rdfjs/types";
import { formatSparqlTerm, buildLiteralFilter, isLiteral } from "../utils/sparqlFormatting.js";

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

        const s = formatSparqlTerm(subject) || "?s";
        const p = formatSparqlTerm(predicate) || "?p";
        let o = formatSparqlTerm(object, true) || "?o";

        const wherePatterns: string[] = [];

        if (isLiteral(object)) {
            // It's a literal! Use variable + robust filter for semantic matching
            wherePatterns.push(`${s} ${p} ?o .`);
            wherePatterns.push(buildLiteralFilter("?o", "=", object));
            o = "?o";
        } else {
            wherePatterns.push(`${s} ${p} ${o} .`);
        }

        const query = `
      PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
      CONSTRUCT { ${s} ${p} ${o} }
      WHERE {
        ${wherePatterns.join('\n        ')}
      }
      LIMIT ${limit}
    `;

        const quads = await this.queryService.executeConstructQuery(query, [this.sparqlEndpoint]);

        if (quads.length === 0) {
            return [];
        }

        return quads;
    }
}
