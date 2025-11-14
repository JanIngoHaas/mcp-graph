/**
 * Utility functions used across the application
 */

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

// ============================== QUERY Generation Helpers ==============================





