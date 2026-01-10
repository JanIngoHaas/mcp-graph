import { Quad } from "@rdfjs/types";
import { PrefixManager } from "./PrefixManager.js";
import { Writer } from "n3";

/**
 * Formats a URI identifier into a readable camelCase name
 * @param identifier - The URI or identifier to format
 * @returns A formatted camelCase string
 */
export function formatIdentifier(identifier: string): string {
  const uriSegment = identifier.split(/[#/]/).pop() || identifier;

  const parts = uriSegment
    .split(/[_\-\.\s]/)
    .map((s) => s.toLowerCase())
    .filter((s) => s.length > 0);

  if (parts.length === 0) return identifier;

  const first = parts[0];
  const rest = parts
    .slice(1)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));

  return first + rest.join("");
}

/**
 * Gets a readable name for a URI, preferring the provided label over the formatted identifier
 * @param uri - The URI to get a name for
 * @param label - Optional label to use instead of the formatted URI
 * @returns A human-readable name
 */
export function getReadableName(uri: string, label?: string): string {
  if (label) return label;
  return formatIdentifier(uri);
}

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
 * Generates a Markdown table from Quads
 */
export function formatQuadsToMarkdown(quads: Quad[]): string {
  if (quads.length === 0) return "No triples found.";

  const prefixManager = PrefixManager.getInstance();
  let md = `## Found ${quads.length} triples\n\n`;
  md += "| Subject | Predicate | Object |\n";
  md += "|---------|-----------|--------|\n";

  quads.forEach((quad) => {
    const escapedS = quad.subject.value.replace(/\|/g, "\\|");
    const escapedP = quad.predicate.value.replace(/\|/g, "\\|");
    const escapedO = quad.object.value.replace(/\|/g, "\\|");
    md += `| ${escapedS} | ${escapedP} | ${escapedO} |\n`;
  });

  return prefixManager.compressTextWithPrefixes(md);
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

/**
 * Generates the full Citation HTML Page
 */
export async function generateCitationHtml(quads: Quad[], citationId: string): Promise<string> {
  // Generate TTL for the raw view
  const ttl = await formatQuadsToTtl(quads);

  // Generate rows for the table
  const rows = quads.map(quad => `
    <tr>
      <td>${renderTermHTML(quad.subject)}</td>
      <td>${renderTermHTML(quad.predicate)}</td>
      <td>${renderTermHTML(quad.object)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html>
<head>
    <title>Citation ${citationId}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 20px; line-height: 1.6; color: #333; max-width: 1200px; margin: 0 auto; }
        h1 { margin-bottom: 20px; border-bottom: 2px solid #eee; padding-bottom: 10px; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 30px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background-color: #f7f7f7; font-weight: 600; position: sticky; top: 0; }
        tr:nth-child(even) { background-color: #fcfcfc; }
        tr:hover { background-color: #f0f7ff; }
        a { text-decoration: none; color: #0066cc; }
        a:hover { text-decoration: underline; }
        .raw-section { background: #f9f9f9; padding: 15px; border: 1px solid #eee; border-radius: 4px; overflow-x: auto; }
        pre { margin: 0; font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace; font-size: 13px; }
        .meta { color: #666; margin-bottom: 20px; font-size: 14px; }
    </style>
</head>
<body>
    <h1>Invocation Verification</h1>
    <div class="meta">Citation ID: <code>${citationId}</code> &bull; Triples: ${quads.length}</div>
    
    <table>
      <thead>
        <tr><th>Subject</th><th>Predicate</th><th>Object</th></tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>

    <h3>Raw Source (Turtle)</h3>
    <div class="raw-section">
        <pre>${escapeHTML(ttl)}</pre>
    </div>
</body>
</html>`;
}
