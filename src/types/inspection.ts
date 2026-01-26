/**
 * Types for InspectionService results
 * Services return structured data, formatting happens at call site
 */

/**
 * Data for a class/ontology inspection
 */
export interface ClassInspection {
    uri: string;
    label: string;
    description?: string;
    /** Properties where this class is the domain (outgoing connections) */
    domains: Map<string, string>;
    /** Properties where this class is the range (incoming connections) */
    ranges: Map<string, string>;
}

/**
 * Data for a property inspection
 */
export interface PropertyInspection {
    uri: string;
    label: string;
    description?: string;
    /** Classes that can be subjects of this property */
    domains: Map<string, string>;
    /** Classes that can be objects of this property */
    ranges: Map<string, string>;
    /** Hierarchy information for each domain class */
    domainHierarchies: Map<string, string>;
    /** Hierarchy information for each range class */
    rangeHierarchies: Map<string, string>;
}

/**
 * A value in a data connection (entity property)
 */
export interface DataConnectionValue {
    value: string;
    label?: string;
}

/**
 * Data for an entity/instance inspection
 */
export interface EntityInspection {
    uri: string;
    label: string;
    /** Outgoing connections: property -> values */
    outgoing: Map<string, DataConnectionValue[]>;
    /** Incoming connections: property -> source entities */
    incoming: Map<string, DataConnectionValue[]>;
    /** Properties that were requested to be expanded */
    expandedProperties: string[];
}

/**
 * Union type for all inspection results
 */
export type InspectionResult =
    | { type: "class"; data: ClassInspection }
    | { type: "property"; data: PropertyInspection }
    | { type: "entity"; data: EntityInspection }
    | { type: "notFound"; uri: string };
