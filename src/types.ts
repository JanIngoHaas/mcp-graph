export interface LabelledNode {
  uri: string;
  label?: string;
}

export interface TypeInfo {
  typeUri: string;
  label?: string;
  description?: string;
}

export interface PropertyInfo {
  propertyUri: string;
  label?: string;
  description?: string;
  domainRangePairs: Map<string, { domain: TypeInfo, range: TypeInfo }>;
}

export interface ExplorationOptions {
  includeLabels?: boolean;
  includeDescriptions?: boolean;
  batchSize?: number;
  onProgress?: (processed: number, total?: number) => void;
  llmBasedExampleQuery?: boolean;
}

export interface ResourceResult {
  uri: string;
  label?: string;
  description?: string;
  type?: string;
}

export interface OntologyInfo {
  ontologyUri: string;
  ontologyType: "metadata" | "probably data";
}

export interface OntologyItem {
  uri: string;
  label?: string;
  description?: string;
}

export interface PropertyMapByPosition {
  subject: Map<string, LabelledNode[]>;    // property -> [objects] where inspected URI is subject
  object: Map<string, LabelledNode[]>;     // property -> [subjects] where inspected URI is object  
  predicate: Array<{subject: LabelledNode, object: LabelledNode}>; // connections where inspected URI is predicate
}