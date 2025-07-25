
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

export interface OntologyItem {
  uri: string;
  label?: string;
  description?: string;
}