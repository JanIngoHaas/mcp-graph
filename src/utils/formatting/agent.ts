import { PrefixManager } from "../PrefixManager.js";
import type { InspectionResult, ClassInspection, PropertyInspection, EntityInspection, ResourceResult, QueryBuilderResult } from "../../types/index.js";
import { MAX_VALUES_TO_SHOW_INLINE, generateMarkdownTable, SEARCH_RESULT_TEXT_LIMIT, SEARCH_RESULT_TRUNCATE_LENGTH } from "./shared.js";
import { formatQuadsToMarkdown } from "./quads.js";
import type { Quad } from "@rdfjs/types";

/**
 * Format an InspectionResult for the agent (compact, uses prefixes)
 */
export function formatInspectionForAgent(result: InspectionResult): string {
    const prefixManager = PrefixManager.getInstance();

    switch (result.type) {
        case "class":
            return formatClassInspectionForAgent(result.data, prefixManager);
        case "property":
            return formatPropertyInspectionForAgent(result.data, prefixManager);
        case "entity":
            return formatEntityInspectionForAgent(result.data, prefixManager);
        case "notFound":
            return `No information found for URI: <${result.uri}>\n\nThis URI appears to be neither a class/property nor an instance with data connections in the knowledge graph.`;
    }
}

function formatClassInspectionForAgent(data: ClassInspection, prefixManager: PrefixManager): string {
    let result = `# Class: ${data.label}\nURI: <${data.uri}>\n\n`;

    if (data.description) {
        result += `## Description\n${data.description}\n\n`;
    }

    if (data.domains.size > 0) {
        result += `## Outgoing connections (Properties)\n\n`;
        result += "| URI | Label |\n";
        result += "|-----|-------|\n";
        for (const [uri, label] of data.domains) {
            const escapedLabel = label.replace(/\|/g, "\\|");
            result += `| ${uri} | ${escapedLabel} |\n`;
        }
        result += "\n";
    }

    if (data.ranges.size > 0) {
        result += `## Incoming connections (Properties)\n\n`;
        result += "| URI | Label |\n";
        result += "|-----|-------|\n";
        for (const [uri, label] of data.ranges) {
            const escapedLabel = label.replace(/\|/g, "\\|");
            result += `| ${uri} | ${escapedLabel} |\n`;
        }
        result += "\n";
    }

    return prefixManager.compressTextWithPrefixes(result, true);
}

function formatPropertyInspectionForAgent(data: PropertyInspection, prefixManager: PrefixManager): string {
    let result = `# Property: ${data.label}\nURI: <${data.uri}>\n\n`;

    if (data.description) {
        result += `## Description\n${data.description}\n\n`;
    }

    if (data.domains.size > 0) {
        result += `## Domain Classes (subjects that can use this property)\n\n`;
        result += "| URI | Label |\n";
        result += "|-----|-------|\n";
        for (const [uri, label] of data.domains) {
            const escapedLabel = label.replace(/\|/g, "\\|");
            result += `| ${uri} | ${escapedLabel} |\n`;
        }
        result += "\n";
    }

    if (data.ranges.size > 0) {
        result += `## Range Classes (objects this property can point to)\n\n`;
        result += "| URI | Label |\n";
        result += "|-----|-------|\n";
        for (const [uri, label] of data.ranges) {
            const escapedLabel = label.replace(/\|/g, "\\|");
            result += `| ${uri} | ${escapedLabel} |\n`;
        }
        result += "\n";
    }

    result += `## SPARQL Usage:\n`;
    result += `?subject <${data.uri}> ?object\n`;

    return prefixManager.compressTextWithPrefixes(result, false);
}

function formatEntityInspectionForAgent(data: EntityInspection, prefixManager: PrefixManager): string {
    let result = `# Data connections for: ${data.label}\nURI: <${data.uri}>\n\n`;

    if (data.outgoing.size > 0) {
        result += `## Outgoing Data Connections (${data.outgoing.size} properties)\n`;
        result += "| Property | Sample Values |\n";
        result += "|----------|---------------|\n";

        for (const [propertyUri, values] of data.outgoing) {
            const isExpanded = data.expandedProperties.includes(propertyUri);
            const valueStrings = values.map(v => v.value);
            const sampleValues = isExpanded
                ? valueStrings.join(", ")
                : valueStrings.slice(0, MAX_VALUES_TO_SHOW_INLINE).join(", ") +
                (valueStrings.length > MAX_VALUES_TO_SHOW_INLINE ? `, ... (+${valueStrings.length - MAX_VALUES_TO_SHOW_INLINE} more)` : "");

            const escapedSamples = sampleValues.replace(/\|/g, "\\|").replace(/\n/g, " ");
            result += `| ${propertyUri} | ${escapedSamples} |\n`;
        }
        result += "\n";
    }

    if (data.incoming.size > 0) {
        result += `## Incoming Data Connections (${data.incoming.size} properties)\n`;
        result += "| Property | Sample Entities |\n";
        result += "|----------|----------------|\n";

        for (const [propertyUri, values] of data.incoming) {
            const isExpanded = data.expandedProperties.includes(propertyUri);
            const valueStrings = values.map(v => v.value);
            const sampleValues = isExpanded
                ? valueStrings.join(", ")
                : valueStrings.slice(0, MAX_VALUES_TO_SHOW_INLINE).join(", ") +
                (valueStrings.length > MAX_VALUES_TO_SHOW_INLINE ? `, ... (+${valueStrings.length - MAX_VALUES_TO_SHOW_INLINE} more)` : "");

            const escapedSamples = sampleValues.replace(/\|/g, "\\|").replace(/\n/g, " ");
            result += `| ${propertyUri} | ${escapedSamples} |\n`;
        }
        result += "\n";
    }

    return prefixManager.compressTextWithPrefixes(result);
}

/**
 * Format search results for the agent
 */
export function formatResourceResultForAgent(results: ResourceResult[]): string {
    if (results.length === 0) {
        return "No entities found matching your search query. Try different keywords or check if the entities exist in the knowledge graph.";
    }

    const rows = results.map((result: ResourceResult) => {
        const uri = result.uri.replace(/\|/g, "\\|");
        const textProp = (result.textProp || "").replace(/\|/g, "\\|");
        const searchText = result.searchText
            ? (result.searchText.length > SEARCH_RESULT_TEXT_LIMIT
                ? result.searchText.substring(0, SEARCH_RESULT_TRUNCATE_LENGTH) + "..."
                : result.searchText).replace(/\|/g, "\\|").replace(/\n/g, " ")
            : "";

        return [uri, textProp, searchText];
    });

    const table = generateMarkdownTable(["URI", "Property", "Matching Text"], rows);

    let response = `## Found ${results.length} entities\n\n${table}\n\n*Use \`inspect\` tool with any URI above for detailed information*`;
    const prefixManager = PrefixManager.getInstance();
    response = prefixManager.compressTextWithPrefixes(response);
    return response;
}

/**
 * Format triples for the agent
 */
export function formatTriplesForAgent(quads: Quad[]): string {
    // Agent view uses compressed prefixes (true)
    return formatQuadsToMarkdown(quads, true);
}

/**
 * Format query builder results for the agent
 */
export function formatQueryBuilderResultForAgent(result: QueryBuilderResult): string {
    return formatQuadsToMarkdown(result.quads, true);
}
