import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import peggy from "peggy";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface QueryNode {
  type: 'term' | 'words' | 'or' | 'and';
}

export interface TermNode extends QueryNode {
  type: 'term';
  value: string;
}

export interface WordsNode extends QueryNode {
  type: 'words';
  words: string[];
}

export interface BinaryOpNode extends QueryNode {
  type: 'or' | 'and';
  left: QASTNode;
  right: QASTNode;
}

export type QASTNode = TermNode | WordsNode | BinaryOpNode;

export interface SearchBackend {
  generateWordsSearchPattern(words: string[], variable: string): string;
}


export class FallbackBackend implements SearchBackend {
  generateWordsSearchPattern(words: string[], variable: string): string {
    // Use multiple CONTAINS conditions joined with AND for all cases
    const conditions = words.map(word => `CONTAINS(LCASE(STR(${variable})), LCASE("${word}"))`);
    return `FILTER(${conditions.join(' && ')})`;
  }

  private escapeRegex(word: string): string {
    // Escape special regex characters
    return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

export class QLeverBackend implements SearchBackend {
  private buildAnchorVar(variable: string): string {
    // Derive a unique anchor variable per searched variable to avoid accidental joins
    // across multiple textSearch SERVICE blocks.
    const base = variable.replace(/^[?$]/, '');
    const sanitized = base.replace(/[^A-Za-z0-9_]/g, '_');
    return `?anchor_${sanitized || 'var'}`;
  }

  generateWordsSearchPattern(words: string[], variable: string): string {
    const allWords: string[] = [];
    words.forEach(word => {
      // Split on any non-alphanumeric character to match QLever's indexing
      const parts = word.split(/[^a-zA-Z0-9]+/).filter(w => w.length > 0);
      allWords.push(...parts);
    });

    if (allWords.length === 0) {
      return "";
    }

    // Use anchor pattern for QLever text search
    const anchorVar = this.buildAnchorVar(variable);
    const wordConditions = allWords.map(word =>
      `${anchorVar} textSearch:contains [ textSearch:word "${word.toLocaleLowerCase()}*" ]`
    ).join(' . ');
    const entityCondition = `${anchorVar} textSearch:contains [ textSearch:entity ${variable} ]`;

    return `SERVICE textSearch: { ${wordConditions} . ${entityCondition} }`;
  }
}

export class QueryParserService {
  private parser: any;
  private backend: SearchBackend;

  constructor(backend: SearchBackend = new FallbackBackend()) {
    this.backend = backend;
    this.initializeParser();
  }

  private initializeParser() {
    try {
      const grammarPath = join(__dirname, '../grammar/query.pegjs');
      const grammar = readFileSync(grammarPath, 'utf8');
      this.parser = peggy.generate(grammar);
    } catch (error) {
      console.error('Failed to load grammar:', error);
      throw new Error('Parser initialization failed');
    }
  }

  public parse(query: string): QASTNode {
    try {
      return this.parser.parse(query.trim());
    } catch (error) {
      throw new Error(`Parse error: ${(error as Error).message}`);
    }
  }

  /**
   * Generate SPARQL WHERE clause patterns from parsed AST
   * @param ast Parsed query AST
   * @param labelVariable Variable name for the label (default: "searchLabel")
   * @returns SPARQL pattern string
   */
  public generateSparqlPattern(ast: QASTNode, labelVariable: string = "searchLabel"): string {
    return this.nodeToSparql(ast, labelVariable);
  }

  /**
   * Parse query and generate SPARQL pattern in one step
   */
  public parseAndGeneratePattern(query: string, labelVariable: string = "searchLabel"): string {
    const ast = this.parse(query);
    return this.generateSparqlPattern(ast, labelVariable);
  }

  private nodeToSparql(node: QASTNode, labelVariable: string): string {
    switch (node.type) {
      case 'term':
        return this.backend.generateWordsSearchPattern([node.value], labelVariable);

      case 'words':
        return this.backend.generateWordsSearchPattern(node.words, labelVariable);

      case 'or':
        const leftPattern = this.nodeToSparql(node.left, labelVariable);
        const rightPattern = this.nodeToSparql(node.right, labelVariable);
        return `{ ${leftPattern} } UNION { ${rightPattern} }`;

      case 'and':
        const leftAndPattern = this.nodeToSparql(node.left, labelVariable);
        const rightAndPattern = this.nodeToSparql(node.right, labelVariable);
        return `{ ${leftAndPattern} } . { ${rightAndPattern} }`;

      default:
        throw new Error(`Unknown node type: ${(node as any).type}`);
    }
  }
}

// I imagine somethign like this: 
// TODO:
// (search(rdfs:label, "Donald || Knuth") AND $ent.price > 50) => Basically a generalization of the current search function (we retain this of course...) 

// export type EASTNode = AtomicNode | ComparisonNode | BinaryNode;

// export interface AtomicNode {
//   type: 'atomic';
//   value: string;
// }

// export interface ComparisonNode {
//   type: 'comparison';
//   left: AtomicNode;
//   right: AtomicNode;
//   operator: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte';
// }

// export interface BinaryNode {
//   type: 'binary';
//   left: EASTNode;
//   right: EASTNode;
//   operator: 'or' | 'and';
// }

// export class ExpressionParserService {
//   private queryParserService: QueryParserService;

//   constructor(queryParserService: QueryParserService) {
//     this.queryParserService = queryParserService;
//   }

//   public parse(query: string): EASTNode {
//     return this.queryParserService.parse(query);
//   }

// }
