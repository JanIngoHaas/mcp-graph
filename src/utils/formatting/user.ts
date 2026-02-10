import type { InspectionResult, ClassInspection, PropertyInspection, EntityInspection, ResourceResult, QueryBuilderResult } from "../../types/index.js";
import { getReadableName } from "../sparqlFormatting.js";
import { MAX_VALUES_TO_SHOW_INLINE, SEARCH_RESULT_TEXT_LIMIT, SEARCH_RESULT_TRUNCATE_LENGTH, escapeHTML } from "./shared.js";
import { renderTechTerm } from "./termUtils.js";
import { Quad } from "@rdfjs/types";

/**
 * Helper to render a consistent property grid (Key-Value layout)
 * This replaces the previous markdown tables with a nice HTML grid
 */
function renderPropertyGrid(items: { label: string, value: string }[]): string {
    let html = `<div class="property-grid">\n`;
    for (const item of items) {
        html += `<div class="prop-name">${item.label}</div>\n`;
        html += `<div class="prop-values">${item.value}</div>\n`;
    }
    html += `</div>\n`;
    return html;
}

/**
 * Format an InspectionResult for the user
 */
export function formatInspectionForUser(result: InspectionResult): string {
    switch (result.type) {
        case "class":
            return formatClassInspectionForUser(result.data);
        case "property":
            return formatPropertyInspectionForUser(result.data);
        case "entity":
            return formatEntityInspectionForUser(result.data);
        case "notFound":
            return `<div class="inspection-container">\n\n<h1>Resource Not Found</h1>\n\n<div class="intro-description">This resource doesn't appear to exist in the knowledge graph. The URI may be incorrect, or the resource may not have been indexed yet.</div>\n\n</div>`;
    }
}

function formatClassInspectionForUser(data: ClassInspection): string {
    let result = `<div class="inspection-container">\n\n<h1>${escapeHTML(data.label)}</h1>\n\n`;
    result += `<div class="meta-info"><strong>Type:</strong> ${renderTechTerm('Class')}</div>\n\n`;

    if (data.description) {
        result += `<div class="intro-description">${escapeHTML(data.description)}</div>\n\n`;
    }

    // Summary statistics
    const totalProps = data.domains.size + data.ranges.size;
    if (totalProps > 0) {
        result += `<div class="summary-box">\n\n<strong>Summary:</strong> This ${renderTechTerm('Class')} has ${data.domains.size} ${renderTechTerm('Property', 'attributes')} that can be used on data entries, and is referenced by ${data.ranges.size} attributes as a valid value type.\n\n</div>\n\n`;
    }

    if (data.domains.size > 0) {
        result += `<div class="inspection-section">\n\n<h3>Available ${renderTechTerm('Property', 'Attributes')}</h3>\n\n<div class="section-description">Attributes that can be used to describe ${renderTechTerm('Instance', 'Data Entries')} in this Category.</div>\n`;

        const gridItems = [];
        gridItems.push({
            label: `${renderTechTerm('Property', 'Attributes')} (${data.domains.size})`,
            value: Array.from(data.domains).map(([uri, label]) => `<a href="${uri}" class="value-tag" target="_blank">${escapeHTML(label)}</a>`).join('\n')
        });

        result += renderPropertyGrid(gridItems);
        result += `</div>\n`;
    }

    if (data.ranges.size > 0) {
        result += `<div class="inspection-section">\n\n<h3>Connected To ${renderTechTerm('Incoming')}</h3>\n\n<div class="section-description">Attributes from other Categories that point to this Category.</div>\n`;

        const gridItems = [];
        gridItems.push({
            label: `Inbound ${renderTechTerm('Property', 'Attributes')} (${data.ranges.size})`,
            value: Array.from(data.ranges).map(([uri, label]) => `<a href="${uri}" class="value-tag" target="_blank">${escapeHTML(label)}</a>`).join('\n')
        });

        result += renderPropertyGrid(gridItems);
        result += `</div>\n`;
    }

    if (totalProps === 0) {
        result += `<div class="empty-state">\n\n<strong>Note:</strong> No relationships found for this ${renderTechTerm('Class')}.\n\n</div>\n\n`;
    }

    result += `</div>`;
    return result;
}

function formatPropertyInspectionForUser(data: PropertyInspection): string {
    let result = `<div class="inspection-container">\n\n<h1>${escapeHTML(data.label)}</h1>\n\n`;
    result += `<div class="meta-info"><strong>Type:</strong> ${renderTechTerm('Property', 'Attribute Type')}</div>\n\n`;

    if (data.description) {
        result += `<div class="intro-description">${escapeHTML(data.description)}</div>\n\n`;
    }

    // Summary statistics
    if (data.domains.size > 0 || data.ranges.size > 0) {
        result += `<div class="summary-box">\n\n<strong>Summary:</strong> This ${renderTechTerm('Property', 'Attribute')} connects `;
        if (data.domains.size > 0) {
            result += `${data.domains.size} Categor${data.domains.size > 1 ? 'ies' : 'y'}`;
        } else {
            result += `any Category`;
        }
        result += ` to `;
        if (data.ranges.size > 0) {
            result += `${data.ranges.size} Type${data.ranges.size > 1 ? 's' : ''}`;
        } else {
            result += `any Value`;
        }
        result += `.\n\n</div>\n\n`;
    }

    if (data.domains.size > 0) {
        result += `<div class="inspection-section">\n\n<h3>${renderTechTerm('Domain')}</h3>\n\n<div class="section-description">${renderTechTerm('Instance', 'Data Entries')} in these Categories can have this Attribute.</div>\n`;
        const gridItems = [{
            label: `${renderTechTerm('Domain', 'Categories')} (${data.domains.size})`,
            value: Array.from(data.domains).map(([uri, label]) => `<a href="${uri}" class="value-tag" target="_blank">${escapeHTML(label)}</a>`).join('\n')
        }];
        result += renderPropertyGrid(gridItems);
        result += `</div>\n`;
    }

    if (data.ranges.size > 0) {
        result += `<div class="inspection-section">\n\n<h3>${renderTechTerm('Range', 'Points to / Expects')}</h3>\n\n<div class="section-description">This Attribute points to Data Entries in these Categories or Data Types.</div>\n`;
        const gridItems = [{
            label: `${renderTechTerm('Range', 'Types')} (${data.ranges.size})`,
            value: Array.from(data.ranges).map(([uri, label]) => `<a href="${uri}" class="value-tag" target="_blank">${escapeHTML(label)}</a>`).join('\n')
        }];
        result += renderPropertyGrid(gridItems);
        result += `</div>\n`;
    }

    if (data.domains.size === 0 && data.ranges.size === 0) {
        result += `<div class="empty-state">\n\n<strong>Note:</strong> No constraints found for this Attribute.\n\n</div>\n\n`;
    }

    result += `</div>`;
    return result;
}

function formatEntityInspectionForUser(data: EntityInspection): string {
    let result = `<div class="inspection-container">\n\n<h1>${escapeHTML(data.label)}</h1>\n\n`;
    result += `<div class="meta-info"><strong>Type:</strong> ${renderTechTerm('Entity', 'Data Entry')}</div>\n\n`;

    // Summary statistics
    const totalOutgoing = data.outgoing.size;
    const totalIncoming = data.incoming.size;
    let totalOutgoingValues = 0;
    let totalIncomingValues = 0;
    for (const values of data.outgoing.values()) totalOutgoingValues += values.length;
    for (const values of data.incoming.values()) totalIncomingValues += values.length;

    if (totalOutgoing > 0 || totalIncoming > 0) {
        result += `<div class="summary-box">\n\n<strong>Summary:</strong> This ${renderTechTerm('Entity', 'Data Entry')} has ${totalOutgoing} ${renderTechTerm('Property', 'attributes')} (${totalOutgoingValues} values) and is referenced by ${totalIncoming} other entries (${totalIncomingValues} references).\n\n</div>\n\n`;
    }

    if (data.outgoing.size > 0) {
        result += `<div class="inspection-section">\n\n<h3>${renderTechTerm('Property', 'Attributes')}</h3>\n\n<div class="section-description">Attributes and values that describe this Data Entry.</div>\n`;

        const gridItems: { label: string, value: string }[] = [];

        for (const [propertyUri, values] of data.outgoing) {
            const propLabel = getReadableName(propertyUri);
            const isExpanded = data.expandedProperties.includes(propertyUri);
            const valuesToShow = isExpanded ? values : values.slice(0, MAX_VALUES_TO_SHOW_INLINE);

            let valueHtml = '';
            for (const v of valuesToShow) {
                const valueLabel = v.label || getReadableName(v.value);
                const isUri = v.value.startsWith("http://") || v.value.startsWith("https://");

                if (isUri) {
                    valueHtml += `<a href="${v.value}" class="value-tag" target="_blank">${escapeHTML(valueLabel)}</a>\n`;
                } else {
                    valueHtml += `<span class="value-tag value-literal">${escapeHTML(v.value)}</span>\n`;
                }
            }

            if (!isExpanded && values.length > MAX_VALUES_TO_SHOW_INLINE) {
                valueHtml += `<span class="value-tag value-more">... and ${values.length - MAX_VALUES_TO_SHOW_INLINE} more (use expandProperties to see all)</span>\n`;
            }

            gridItems.push({ label: escapeHTML(propLabel), value: valueHtml });
        }

        result += renderPropertyGrid(gridItems);
        result += `</div>\n`;
    }

    if (data.incoming.size > 0) {
        result += `<div class="inspection-section">\n\n<h3>${renderTechTerm('Incoming', 'Referenced By')}</h3>\n\n<div class="section-description">Other Data Entries that link to this one.</div>\n`;

        const gridItems: { label: string, value: string }[] = [];

        for (const [propertyUri, values] of data.incoming) {
            const propLabel = getReadableName(propertyUri);
            const isExpanded = data.expandedProperties.includes(propertyUri);
            const valuesToShow = isExpanded ? values : values.slice(0, MAX_VALUES_TO_SHOW_INLINE);

            let valueHtml = '';
            for (const v of valuesToShow) {
                const valueLabel = v.label || getReadableName(v.value);
                valueHtml += `<a href="${v.value}" class="value-tag" target="_blank">${escapeHTML(valueLabel)}</a>\n`;
            }

            if (!isExpanded && values.length > MAX_VALUES_TO_SHOW_INLINE) {
                valueHtml += `<span class="value-tag value-more">... and ${values.length - MAX_VALUES_TO_SHOW_INLINE} more (use expandProperties to see all)</span>\n`;
            }

            gridItems.push({ label: escapeHTML(propLabel), value: valueHtml });
        }

        result += renderPropertyGrid(gridItems);
        result += `</div>\n`;
    }

    if (totalOutgoing === 0 && totalIncoming === 0) {
        result += `<div class="empty-state">\n\n<strong>Note:</strong> No information found for this ${renderTechTerm('Entity', 'Data Entry')}.\n\n</div>\n\n`;
    }

    result += `</div>`;
    return result;
}

/**
 * Format search results for the user using the consistent Property Grid style
 */
export function formatResourceResultForUser(results: ResourceResult[]): string {
    if (results.length === 0) {
        return `<div class="search-results">\n\n<h2>Search Results</h2>\n\n<div class="empty-state">\n\n<strong>No Data Entries found</strong> matching your search query.\n\nTry:\n- Using different keywords\n- Broadening your search terms\n- Checking for typos\n\n</div>\n\n</div>`;
    }

    let output = `<div class="search-results">\n\n<h2>Search Results</h2>\n\n`;
    output += `<div class="summary-box">\n\n<strong>Found ${results.length} matching ${renderTechTerm('Entity', `Data Entr${results.length === 1 ? 'y' : 'ies'}`)}</strong> in the knowledge graph.\n\n</div>\n\n`;

    // Group results by type if possible, or just list them.
    // For consistency with the "grid" look, we render each result as a row in our grid.

    // Check if we can group by type
    const resultsByType = new Map<string, ResourceResult[]>();
    const uncategorized: ResourceResult[] = [];

    for (const result of results) {
        if (result.textProp && (result.textProp.includes('type') || result.textProp.includes('Type'))) {
            const type = result.searchText || 'Unknown';
            if (!resultsByType.has(type)) resultsByType.set(type, []);
            resultsByType.get(type)!.push(result);
        } else {
            uncategorized.push(result);
        }
    }

    const renderResultsGroup = (groupResults: ResourceResult[]) => {
        const gridItems: { label: string, value: string }[] = [];

        for (const result of groupResults) {
            const uriLabel = getReadableName(result.uri);
            const safeUri = escapeHTML(result.uri);
            const labelHtml = `<div class="result-label"><a href="${safeUri}" target="_blank"><strong>${escapeHTML(uriLabel)}</strong></a><span class="result-uri">${safeUri}</span></div>`;

            let valueHtml = '';
            // If we have property context, show it
            if (result.textProp) {
                const propName = getReadableName(result.textProp);
                // Clean up pipes if any
                const cleanPropName = propName.replace(/\|/g, " ");
                valueHtml += `<div class="match-conn">Matched ${renderTechTerm('Property', 'attribute')}: <span class="match-prop">${escapeHTML(cleanPropName)}</span></div>`;
            }

            if (result.searchText) {
                const text = result.searchText.length > SEARCH_RESULT_TEXT_LIMIT
                    ? result.searchText.substring(0, SEARCH_RESULT_TRUNCATE_LENGTH) + "..."
                    : result.searchText;
                const cleanText = text.replace(/\|/g, " ").replace(/\n/g, " ");
                valueHtml += `<div class="match-text">"${escapeHTML(cleanText)}"</div>`;
            }

            gridItems.push({ label: labelHtml, value: valueHtml || '<span style="color:#999">No additional details</span>' });
        }

        return renderPropertyGrid(gridItems);
    };

    if (resultsByType.size > 0) {
        output += `<div class="results-grouped">\n`;

        // Types
        for (const [type, typeResults] of resultsByType) {
            output += `<details open>\n<summary><strong>${escapeHTML(type)}</strong> (${typeResults.length})</summary>\n\n`;
            output += renderResultsGroup(typeResults);
            output += `\n</details>\n\n`;
        }

        // Uncategorized
        if (uncategorized.length > 0) {
            output += `<details open>\n<summary><strong>Other Results</strong> (${uncategorized.length})</summary>\n\n`;
            output += renderResultsGroup(uncategorized);
            output += `\n</details>\n\n`;
        }

        output += `</div>`;
    } else {
        // Flat list
        output += renderResultsGroup(results);
    }

    output += `</div>`;
    return output;
}

/**
 * Format quads for the user using the consistent Property Grid style
 * Replaces formatQuadsToMarkdown for user-facing views
 */
export function formatQuadsToUserHtml(quads: Quad[]): string {
    if (quads.length === 0) return `<div class="empty-state">No triples found.</div>`;

    // 1. Organize data
    const entityData = new Map<string, Map<string, Set<string>>>();
    const entityTypes = new Map<string, Set<string>>();

    quads.forEach(quad => {
        const s = quad.subject.value;
        const p = quad.predicate.value;
        const o = quad.object.value;

        if (!entityData.has(s)) entityData.set(s, new Map());
        const props = entityData.get(s)!;
        if (!props.has(p)) props.set(p, new Set());
        props.get(p)!.add(o);

        if (p === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type') {
            if (!entityTypes.has(s)) entityTypes.set(s, new Set());
            entityTypes.get(s)!.add(o);
        }
    });

    // 2. Group subjects by Type
    const typeGroups = new Map<string, Set<string>>();
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

    let html = '';

    const renderEntityGroup = (typeName: string, subjects: Set<string>) => {
        const typeLabel = getReadableName(typeName);
        let groupHtml = `<details open>\n<summary><strong>${escapeHTML(typeLabel)}</strong> (${subjects.size})</summary>\n\n`;

        const gridItems: { label: string, value: string }[] = [];

        for (const s of subjects) {
            const label = getReadableName(s);
            const labelHtml = `<a href="${s}" target="_blank"><strong>${escapeHTML(label)}</strong></a>`;

            const props = entityData.get(s)!;
            let valHtml = `<div class="entity-props" style="display:flex; flex-direction:column; gap:4px;">`;

            // Check if there are too many properties, if so, maybe simplify
            const propCount = props.size;
            let propsRendered = 0;
            const MAX_PROPS = 10;

            for (const [p, vals] of props) {
                if (propsRendered >= MAX_PROPS) {
                    valHtml += `<div class="sub-prop" style="color:#888;">... and ${propCount - MAX_PROPS} more ${renderTechTerm('Property', 'attributes')}</div>`;
                    break;
                }

                const pLabel = getReadableName(p);
                valHtml += `<div class="sub-prop">`;
                valHtml += `<span class="sub-prop-name" style="color:#555; font-weight:500;">${escapeHTML(pLabel)}:</span> `;

                const valStrArray = [];
                const valsArr = Array.from(vals);
                const MAX_VALS = MAX_VALUES_TO_SHOW_INLINE;

                for (let i = 0; i < Math.min(valsArr.length, MAX_VALS); i++) {
                    const v = valsArr[i];
                    const isUri = v.startsWith('http');
                    if (isUri) valStrArray.push(`<a href="${v}" target="_blank">${escapeHTML(getReadableName(v))}</a>`);
                    else valStrArray.push(`<span class="value-literal">${escapeHTML(v)}</span>`);
                }

                if (valsArr.length > MAX_VALS) {
                    valStrArray.push(`... (+${valsArr.length - MAX_VALS})`);
                }

                valHtml += valStrArray.join(', ');
                valHtml += `</div>`;
                propsRendered++;
            }
            valHtml += `</div>`;

            gridItems.push({ label: labelHtml, value: valHtml });
        }

        groupHtml += renderPropertyGrid(gridItems);
        groupHtml += `\n</details>\n\n`;
        return groupHtml;
    };

    const sortedTypes = Array.from(typeGroups.keys()).sort();
    for (const typeUri of sortedTypes) {
        html += renderEntityGroup(typeUri, typeGroups.get(typeUri)!);
    }

    if (uncategorized.size > 0) {
        html += renderEntityGroup("Uncategorized Data Entries", uncategorized);
    }

    return html;
}

/**
 * Format triples for the user
 */
export function formatTriplesForUser(quads: Quad[]): string {
    if (quads.length === 0) {
        return `<div class="triples-results">\n\n<h2>Facts</h2>\n\n<div class="empty-state">\n\n<strong>No facts found</strong> matching your query.\n\n</div>\n\n</div>`;
    }

    let output = `<div class="triples-results">\n\n<h2>Facts</h2>\n\n`;
    output += `<div class="summary-box">\n\n<strong>Found ${quads.length} fact${quads.length === 1 ? '' : 's'}</strong>.\n\n</div>\n\n`;
    output += formatQuadsToUserHtml(quads);
    output += `\n</div>`;
    return output;
}

/**
 * Format query builder results for the user
 */
export function formatQueryBuilderResultForUser(result: QueryBuilderResult): string {
    if (result.quads.length === 0) {
        return `<div class="query-results">\n\n<h2>Query Results</h2>\n\n<div class="empty-state">\n\n<strong>No results found</strong> for your query.\n\nThis could mean:\n- No Data Entries match your filter criteria\n- The Category you're querying doesn't exist\n- The attribute paths in your filters don't match any data\n\n</div>\n\n</div>`;
    }

    let output = `<div class="query-results">\n\n<h2>Query Results</h2>\n\n`;

    const uniqueSubjects = new Set<string>();
    for (const quad of result.quads) {
        uniqueSubjects.add(quad.subject.value);
    }

    output += `<div class="summary-box">\n\n<strong>Query returned ${renderTechTerm('Triple', `${result.quads.length} Fact${result.quads.length === 1 ? '' : 's'}`)}</strong> describing <strong>${uniqueSubjects.size} unique ${renderTechTerm('Entity', `Data Entr${uniqueSubjects.size === 1 ? 'y' : 'ies'}`)}</strong>.\n\n</div>\n\n`;

    output += formatQuadsToUserHtml(result.quads);
    output += `\n</div>`;
    return output;
}
