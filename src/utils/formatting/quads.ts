import { Quad } from "@rdfjs/types";
import { PrefixManager } from "../PrefixManager.js";
import { Writer } from "n3";
import { formatLocalName, enrichTextWithLinks } from "../sparqlFormatting.js";
import { generateMarkdownTable } from "./shared.js";

/**
 * Generates a Markdown table from Quads
 */
export function formatQuadsToMarkdown(quads: Quad[], compressed: boolean): string {
    if (quads.length === 0) return "No triples found.";

    const prefixManager = PrefixManager.getInstance();

    // 1. Organize data
    const entityData = new Map<string, Map<string, Set<string>>>();
    const entityTypes = new Map<string, Set<string>>();

    quads.forEach(quad => {
        const s = quad.subject.value;
        const p = quad.predicate.value;
        const o = quad.object.value;

        // Store Entity Properties
        if (!entityData.has(s)) entityData.set(s, new Map());
        const props = entityData.get(s)!;
        if (!props.has(p)) props.set(p, new Set());
        // Escape pipes for Markdown table cells
        props.get(p)!.add(o.replace(/\|/g, '\\|'));

        // Store Types
        if (p === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type') {
            if (!entityTypes.has(s)) entityTypes.set(s, new Set());
            entityTypes.get(s)!.add(o);
        }
    });

    // 2. Group subjects by Type
    const typeGroups = new Map<string, Set<string>>(); // Type -> Set<Subject>
    const uncategorized = new Set<string>();

    for (const s of entityData.keys()) {
        const types = entityTypes.get(s);
        if (types && types.size > 0) {
            types.forEach(t => {
                if (!typeGroups.has(t)) typeGroups.set(t, new Set());
                typeGroups.get(t)!.add(s);
            });
        } else {
            uncategorized.add(s);
        }
    }

    // 3. Build Markdown
    let md = `<div class=\"quads-summary\">**Found ${quads.length} triple${quads.length === 1 ? '' : 's'}** organized by entity type below.</div>\n\n`;

    const generateTable = (typeName: string, subjects: Set<string>) => {
        // Collect all predicates for these subjects to define columns
        const predicates = new Set<string>();
        subjects.forEach(s => {
            const props = entityData.get(s)!;
            for (const p of props.keys()) {
                predicates.add(p);
            }
        });

        // Sort predicates for consistent column order
        const sortedPredicates = Array.from(predicates).sort();

        // 1. Build Headers
        const headers = ["Entity", ...sortedPredicates.map(p => formatLocalName(p))];

        // 2. Build Rows
        const rows = Array.from(subjects).map(s => {
            const props = entityData.get(s)!;
            return [
                s,
                ...sortedPredicates.map(p => {
                    const values = props.get(p);
                    return values ? Array.from(values).join(', ') : '';
                })
            ];
        });

        const table = generateMarkdownTable(headers, rows);
        const typeLabel = formatLocalName(typeName);
        return `<details open><summary>**${typeLabel}** (${subjects.size} entit${subjects.size === 1 ? 'y' : 'ies'})</summary>\n\n${table}\n\n</details>\n\n`;
    };

    // Iterate groups (sort by type name for consistency)
    const sortedTypes = Array.from(typeGroups.keys()).sort();
    for (const typeUri of sortedTypes) {
        md += generateTable(typeUri, typeGroups.get(typeUri)!);
    }

    if (uncategorized.size > 0) {
        md += generateTable("Uncategorized", uncategorized);
    }

    if (compressed) {
        // Model view: use prefixes to save tokens
        return prefixManager.compressTextWithPrefixes(md, true);
    } else {
        // User view: use beautiful [Label](Link) formatting
        return enrichTextWithLinks(md);
    }
}

/**
 * Generates regular TTL from Quads
 */
export async function formatQuadsToTtl(quads: Quad[]): Promise<string> {
    const prefixManager = PrefixManager.getInstance();
    const writer = new Writer({ prefixes: prefixManager.getPrefixMap() });
    writer.addQuads(quads);

    return new Promise<string>((resolve, reject) => {
        writer.end((err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
    });
}
