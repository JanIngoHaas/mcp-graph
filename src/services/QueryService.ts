import { QueryEngine } from "@comunica/query-sparql";
import { QueryStringContext } from "@comunica/types";
import { PrefixManager } from "../utils/PrefixManager.js";

function addDistinctToQuery(query: string): string {
  // Use regex to find SELECT statements and add DISTINCT if not already present
  return query.replace(/\bSELECT\s+(?!DISTINCT\s)/gi, 'SELECT DISTINCT ');
}

export class QueryService {
  private queryEngine: QueryEngine;
  private sparqlToken?: string;

  constructor(sparqlToken?: string) {
    this.queryEngine = new QueryEngine();
    this.sparqlToken = sparqlToken;
  }

  async executeQueryRaw(query: string, sources: Array<string>): Promise<any[]> {
    // Rate limiting: 100ms delay before each query
    const prefixManager = PrefixManager.getInstance();
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Enrich query with PREFIXes

    let modifiedQuery = addDistinctToQuery(query);
    modifiedQuery = prefixManager.addPrefixesToQuery(modifiedQuery);

    const context: QueryStringContext = {
      sources,
    };

    // Add authentication headers if token is provided
    if (this.sparqlToken) {
      context.httpHeaders = {
        'Authorization': `Bearer ${this.sparqlToken}`,
      };
    }

    const bindingsStream = await this.queryEngine.queryBindings(modifiedQuery, context);

    const bindings = await bindingsStream.toArray();
    const results = bindings.map((binding) => {
      const result: any = {};
      for (const [variable, term] of binding) {
        result[variable.value] = {
          value: term.value,
          type: term.termType,
          language: ((term as any).language as string) || undefined,
        };
      }
      return result;
    });

    // Dedup
    const seen = new Set();
    return results.filter((result) => {
      const key = JSON.stringify(result);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  async executeConstructQuery(query: string, sources: Array<string>): Promise<any[]> {
    const prefixManager = PrefixManager.getInstance();
    await new Promise((resolve) => setTimeout(resolve, 100));

    let modifiedQuery = prefixManager.addPrefixesToQuery(query);

    const context: QueryStringContext = {
      sources,
    };

    if (this.sparqlToken) {
      context.httpHeaders = {
        'Authorization': `Bearer ${this.sparqlToken}`,
      };
    }

    const quadStream = await this.queryEngine.queryQuads(modifiedQuery, context);
    const quads = await quadStream.toArray();

    return quads.map(quad => ({
      subject: quad.subject.value,
      predicate: quad.predicate.value,
      object: quad.object.value,
      graph: quad.graph.value
    }));
  }

  async executeQuery(query: string, sources: Array<string>, language: string, maxRows: number = 100): Promise<string> {
    const results = await this.executeQueryRaw(query, sources);
    const prefixManager = PrefixManager.getInstance();

    let languageFilteredResults = results;
    if (language !== "all") {
      languageFilteredResults = results.filter((result) => {
        return Object.values(result).some((field: any) => {
          // Include if field has matching language, no language (undefined), or empty string language
          return !field.language || field.language === "" || field.language === language;
        });
      });
    }

    if (languageFilteredResults.length === 0) {
      return `No results found for language "${language}".`;
    }

    // Apply maxRows limit
    const limitedResults = languageFilteredResults.slice(0, maxRows);
    const wasTruncated = languageFilteredResults.length > maxRows;

    // Extract headers from the first result
    const headers = Object.keys(limitedResults[0]);

    // Convert results to rows of string values
    const rows = limitedResults.map((result) => {
      return headers.map(header => result[header]?.value || '');
    });

    // Format as markdown table
    const headerRow = `| ${headers.join(' | ')} |`;
    const separatorRow = `| ${headers.map(() => '---').join(' | ')} |`;
    const dataRows = rows.map(row => `| ${row.join(' | ')} |`);

    let resultTable = [headerRow, separatorRow, ...dataRows].join('\n');

    // Add truncation notice if results were limited
    if (wasTruncated) {
      resultTable += `\n\n**Note**: Results were limited to ${maxRows} rows. Total matching results: ${languageFilteredResults.length}. To see more results, increase the \`maxRows\` parameter.`;
    }

    resultTable = prefixManager.compressTextWithPrefixes(resultTable);
    return resultTable;
  }
}
