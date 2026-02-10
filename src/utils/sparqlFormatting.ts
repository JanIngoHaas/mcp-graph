import { PrefixManager } from "./PrefixManager.js";

/**
 * SPARQL Formatting Utilities
 * 
 * Provides consistent handling for formatting all types of SPARQL terms:
 * - URIs and Prefixed Names
 * - Numeric Literals
 * - DateTime Literals
 * - String Literals
 */

// --- URI & Prefixed Name Utils ---

/**
 * Format a URI's local name into a human-readable label.
 * e.g., "molarMass" -> "Molar Mass"
 */
export function formatLocalName(uri: string): string {
    const localName = uri.split(/[#/:]/).pop() || uri;
    let formatted = localName.replace(/([a-z])([A-Z])/g, '$1 $2');
    formatted = formatted.replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
    formatted = formatted.replace(/([a-zA-Z])(\d)/g, '$1 $2');
    formatted = formatted.replace(/[_-]/g, ' ');
    return formatted.trim().split(/\s+/)
        .map(word => word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : "")
        .join(' ');
}

/**
 * Gets a readable name for a URI, preferring the provided label.
 */
export function getReadableName(uri: string, label?: string): string {
    if (label) return label;
    return formatLocalName(uri);
}

/**
 * Format a value as a SPARQL URI or Prefixed Name.
 * Throws if the value is not a valid URI/Prefixed Name.
 */
export function formatUriOrPrefixedName(value: string): string {
    if (value.startsWith('http://') || value.startsWith('https://')) {
        return `<${value}>`;
    }
    if (value.includes(':')) {
        return value;
    }
    throw new Error(`Invalid SPARQL URI/Prefixed Name: '${value}'`);
}

/**
 * Resolve a property name to a SPARQL-ready string.
 */
export function resolvePropertyToUri(property: string): string {
    try {
        return formatUriOrPrefixedName(property);
    } catch (e) {
        let prefixManager = PrefixManager.getInstance();
        let availablePrefixes = prefixManager.getAvailablePrefixes();
        throw new Error(`Cannot resolve property '${property}'. Use a full URI or a prefixed name (Available prefixes: ${availablePrefixes.join(', ')}).`);
    }
}

// --- Literal Utils ---

/**
 * Try to parse a value as a number.
 */
export function tryParseNumber(value: string): number | null {
    const trimmed = value.trim();
    const numValue = Number(trimmed);
    return (!isNaN(numValue) && isFinite(numValue)) ? numValue : null;
}

/**
 * Try to parse a value as a datetime.
 */
export function tryParseDateTime(value: string): Date | null {
    const dateValue = new Date(value);
    return (!isNaN(dateValue.getTime())) ? dateValue : null;
}

/**
 * Format a value as a SPARQL Literal.
 * Handles numeric, datetime, and string literals.
 */
export function formatLiteral(value: string): string {
    if (/^".*"(?:\^\^.*|@.*)?$/.test(value)) return value;

    const numValue = tryParseNumber(value);
    if (numValue !== null) return String(numValue);

    const normalizedDateTime = value.trim().replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T');
    const dateValue = tryParseDateTime(normalizedDateTime);
    if (dateValue !== null) return `"${normalizedDateTime}"^^xsd:dateTime`;

    return `"${value}"`;
}

/**
 * Build a SPARQL FILTER expression for a value comparison.
 * Handles numeric and datetime values with semantic comparison.
 */
export function buildLiteralFilter(
    variable: string,
    operator: string,
    value: string
): string {
    const trimmedValue = value.trim();

    const numValue = tryParseNumber(trimmedValue);
    if (numValue !== null) {
        return `FILTER(${variable} ${operator} ${numValue})`;
    }

    const dateValue = tryParseDateTime(trimmedValue);
    if (dateValue !== null) {
        const isoValue = dateValue.toISOString();
        if (operator === '=') {
            const before = new Date(dateValue.getTime() - 1).toISOString();
            const after = new Date(dateValue.getTime() + 1).toISOString();
            return `FILTER(${variable} > "${before}"^^xsd:dateTime && ${variable} < "${after}"^^xsd:dateTime)`;
        }
        if (operator === '!=') {
            const before = new Date(dateValue.getTime() - 1).toISOString();
            const after = new Date(dateValue.getTime() + 1).toISOString();
            return `FILTER(${variable} <= "${before}"^^xsd:dateTime || ${variable} >= "${after}"^^xsd:dateTime)`;
        }
        return `FILTER(${variable} ${operator} "${isoValue}"^^xsd:dateTime)`;
    }

    return `FILTER(STR(${variable}) ${operator} "${value}")`;
}

// --- Unified Term Formatting ---

/**
 * Check if a value should be treated as a literal.
 */
export function isLiteral(value: string): boolean {
    if (value === "_") return false;
    if (value.startsWith('"') || value.startsWith("'")) return true;
    if (tryParseNumber(value) !== null) return true;
    const normalizedDT = value.trim().replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T');
    if (tryParseDateTime(normalizedDT) !== null) return true;
    // If it doesn't look like a URI or a prefixed name, it's a literal
    return !value.startsWith('http') && !value.includes(':');
}

/**
 * Check if a value is a valid URI or Prefixed Name.
 */
export function isUriOrPrefixedName(value: string): boolean {
    if (value.startsWith('http://') || value.startsWith('https://')) return true;
    // If it has a colon, it might be a prefixed name or a date. 
    // We prioritize checking for dates in isLiteral.
    return value.includes(':') && !isLiteral(value);
}

/**
 * Intelligent term formatter. 
 * Categorizes the input and formats it appropriately for SPARQL.
 */
export function formatSparqlTerm(value: string, isObject: boolean = false): string | null {
    if (value === "_") return null;

    // Categorize
    if (value.startsWith('http://') || value.startsWith('https://')) {
        return `<${value}>`;
    }

    if (isObject) {
        // If it's already formatted
        if (/^".*"(?:\^\^.*|@.*)?$/.test(value)) return value;

        // Try numeric
        const num = tryParseNumber(value);
        if (num !== null) return String(num);

        // Try date
        const normalizedDT = value.trim().replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T');
        if (tryParseDateTime(normalizedDT) !== null) return `"${normalizedDT}"^^xsd:dateTime`;
    }

    // For subjects and predicates, ensure it actually looks like a URI or Prefixed Name
    if (isUriOrPrefixedName(value)) {
        return value;
    }

    // Fallback for objects: plain string literal
    if (isObject) return `"${value}"`;

    throw new Error(`Invalid SPARQL Term: '${value}'. Subjects and Predicates must be URIs or Prefixed Names.`);
}

// --- Text Enrichment (Labels/Links) ---

/**
 * Finds all URIs in a string and formats them as Markdown links.
 */
export function enrichTextWithLinks(text: string): string {
    const uriRegex = /(?<!=")(https?:\/\/[^\s<>"'()\[\]]+[^\s<>"'()\[\].,;:!])/g;
    const result = text.replace(uriRegex, (uri) => `[${formatLocalName(uri)}](${uri})`);
    return result.replace(/(?<!\[[^\]]*)#/g, '\\#');
}

/**
 * Resolve a URI to a human-readable label by querying for rdfs:label.
 */
export async function resolveLabel(
    uri: string,
    queryService: any,
    sparqlEndpoint: string
): Promise<string> {
    let term: string;
    try {
        term = formatUriOrPrefixedName(uri);
    } catch {
        return formatLocalName(uri);
    }

    const query = `
    SELECT ?label WHERE {
      ${term} <http://www.w3.org/2000/01/rdf-schema#label> ?label .
    } LIMIT 1
  `;

    try {
        const results = await queryService.executeQueryRaw(query, [sparqlEndpoint]);
        if (results.length > 0 && results[0].label) {
            return formatLocalName(results[0].label.value);
        }
    } catch { }

    return formatLocalName(uri);
}
