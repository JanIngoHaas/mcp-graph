// Core types for MCP Graph
export interface ResourceResult {
    uri: string;
    textProp: string;
    searchText: string;
}

// Re-export specific category types
export * from "./inspection.js";
export * from "./query.js";
export * from "./explanation.js";
