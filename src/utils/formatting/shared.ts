export const MAX_VALUES_TO_SHOW_INLINE = 4;
export const SEARCH_RESULT_TEXT_LIMIT = 1024;
export const SEARCH_RESULT_TRUNCATE_LENGTH = 255;

/**
 * Escapes HTML special characters
 */
export function escapeHTML(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Renders an RDF Term as HTML with clickable links for NamedNodes
 */
export function renderTermHTML(term: any): string {
    if (term.termType === "NamedNode") {
        const label = escapeHTML(term.value);
        return `<a href="${term.value}" target="_blank">${label}</a>`;
    } else if (term.termType === "Literal") {
        let label = `"${escapeHTML(term.value)}"`;
        if (term.language) {
            label += `<span style="color: gray">@${escapeHTML(term.language)}</span>`;
        } else if (term.datatype && term.datatype.value !== "http://www.w3.org/2001/XMLSchema#string") {
            const datatype = escapeHTML(term.datatype.value);
            label += ` <small title="${datatype}" style="color: gray">^^${datatype.split(/[#/]/).pop()}</small>`;
        }
        return label;
    }
    return escapeHTML(term.value);
}

/**
 * Generates a standard Markdown table
 */
export function generateMarkdownTable(headers: string[], rows: string[][]): string {
    if (headers.length === 0) return "";
    const headerRow = `| ${headers.join(" | ")} |`;
    const separatorRow = `| ${headers.map(() => "---").join(" | ")} |`;
    const dataRows = rows.map((row) => `| ${row.join(" | ")} |`);
    return [headerRow, separatorRow, ...dataRows].join("\n");
}
