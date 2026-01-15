import { PrefixManager } from "../utils/PrefixManager.js";

/**
 * Format a URI's local name into a human-readable label
 * e.g., "molarMass" -> "Molar Mass", "ChemicalSubstance" -> "Chemical Substance"
 */
export function formatLocalName(uri: string): string {
    // Split by #, /, or : to handle full URIs and prefixed names
    const localName = uri.split(/[#/:]/).pop() || uri;

    // Insert spaces between camelCase (e.g., camelCase -> camel Case, YearOf -> Year Of)
    let formatted = localName.replace(/([a-z])([A-Z])/g, '$1 $2');
    formatted = formatted.replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');

    // Insert spaces before numbers
    formatted = formatted.replace(/([a-zA-Z])(\d)/g, '$1 $2');

    // Replace underscores and hyphens with spaces
    formatted = formatted.replace(/[_-]/g, ' ');

    // Normalize spaces and capitalize
    formatted = formatted.trim().split(/\s+/)
        .map(word => {
            if (!word) return "";
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join(' ');

    return formatted;
}

/**
 * Gets a readable name for a URI, preferring the provided label over the formatted identifier
 * @param uri - The URI to get a name for
 * @param label - Optional label to use instead of the formatted URI
 * @returns A human-readable name
 */
export function getReadableName(uri: string, label?: string): string {
    if (label) return label;
    return formatLocalName(uri);
}

/**
 * Format a value for use in SPARQL queries, handling both URIs and prefixed names.
 * This is the standard formatter for subjects and objects.
 * @param value - The value to format (URI or prefixed name)
 * @returns Formatted value for SPARQL query
 */
export function formatSparqlValue(value: string): string {
    // If it starts with http, wrap it in angle brackets
    if (value.startsWith('http://') || value.startsWith('https://')) {
        return `<${value}>`;
    }
    // If it contains a colon, assume it's a prefixed name
    if (value.includes(':')) {
        return value;
    }
    // Otherwise, throw an error
    throw new Error(`Invalid SPARQL value: '${value}'. Must be a full URI or a prefixed name.`);
}

/**
 * Resolve a property name to a SPARQL-ready string.
 * This is "smarter" than formatSparqlValue as it handles:
 * 1. Already bracketed URIs <...>
 * 2. The 'label' keyword -> rdfs:label
 * @param property - The property string to resolve
 * @returns SPARQL-ready property URI or prefixed name
 */
export function resolvePropertyToUri(property: string): string {
    // If it's already a full URI in brackets, return as is
    if (property.startsWith('<') && property.endsWith('>')) {
        return property;
    }

    // Special case: 'label' means <http://www.w3.org/2000/01/rdf-schema#label>
    if (property === 'label') {
        return '<http://www.w3.org/2000/01/rdf-schema#label>';
    }

    // Reuse formatSparqlValue for the rest
    try {
        return formatSparqlValue(property);
    } catch (e) {
        let prefixManager = PrefixManager.getInstance();
        let availablePrefixes = prefixManager.getAvailablePrefixes();
        throw new Error(`Cannot resolve property '${property}'. Use a full URI (optionally in <...>), a prefixed name (using one of the following prefixes: ${availablePrefixes.join(', ')}), or 'label'.`);
    }
}

/**
 * Finds all URIs in a string and formats them as Markdown links: [Local Name](URI)
 * Also escapes # to \# for Markdown safety.
 * @param text - The text to process
 * @returns Text with URIs replaced by pretty Markdown links
 */
export function enrichTextWithLinks(text: string): string {
    // Match http(s):// but not if it's preceded by '="' (to protect href attributes)
    const uriRegex = /(?<!=")(https?:\/\/[^\s<>"'()\[\]]+[^\s<>"'()\[\].,;:!])/g;

    const result = text.replace(uriRegex, (uri) => {
        const label = formatLocalName(uri);
        return `[${label}](${uri})`;
    });

    // Escape # but only if not part of a link already
    return result.replace(/(?<!\[[^\]]*)#/g, '\\#');
}

/**
 * Resolve a URI to a human-readable label by querying for rdfs:label
 * Falls back to formatting the local name if no label is found
 * @param uri - The URI to resolve
 * @param queryService - QueryService instance for executing SPARQL queries
 * @param sparqlEndpoint - The SPARQL endpoint to query
 * @returns A human-readable label
 */
export async function resolveLabel(
    uri: string,
    queryService: any,
    sparqlEndpoint: string
): Promise<string> {
    // Try to get rdfs:label from the graph
    let subjectNode: string;
    try {
        subjectNode = formatSparqlValue(uri);
    } catch {
        return formatLocalName(uri);
    }

    // Using full URI for rdfs:label to avoid PrefixManager dependency
    const query = `
    SELECT ?label WHERE {
      ${subjectNode} <http://www.w3.org/2000/01/rdf-schema#label> ?label .
    } LIMIT 1
  `;

    try {
        const results = await queryService.executeQueryRaw(query, [sparqlEndpoint]);
        if (results.length > 0 && results[0].label) {
            return formatLocalName(results[0].label.value);
        }
    } catch (error) {
        // Fall back to extracting from URI
    }

    // Extract local name and format it
    return formatLocalName(uri);
}
