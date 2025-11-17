import { QueryEngine } from "@comunica/query-sparql";
import { QueryStringContext } from "@comunica/types";

function addDistinctToQuery(query: string): string {
  // Use regex to find SELECT statements and add DISTINCT if not already present
  return query.replace(/\bSELECT\s+(?!DISTINCT\s)/gi, 'SELECT DISTINCT ');
}

export class QueryService {
  private queryEngine: QueryEngine;

  constructor() {
    this.queryEngine = new QueryEngine();
  }

  async executeQueryRaw(query: string, sources: Array<string>): Promise<any[]> {
    // Rate limiting: 100ms delay before each query
    await new Promise((resolve) => setTimeout(resolve, 100));

    const modifiedQuery = addDistinctToQuery(query);

    const bindingsStream = await this.queryEngine.queryBindings(modifiedQuery, {
      sources,
    } as QueryStringContext);

    const bindings = await bindingsStream.toArray();
    const results = bindings.map((binding) => {
      const result: any = {};
      for (const [variable, term] of binding) {
        result[variable.value] = {
          value: term.value,
          type: term.termType,
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

  async executeQuery(query: string, sources: Array<string>): Promise<string> {
    const results = await this.executeQueryRaw(query, sources);

    if (results.length === 0) {
      return "No results found.";
    }

    // Extract headers from the first result
    const headers = Object.keys(results[0]);

    // Convert results to rows of string values
    const rows = results.map((result) => {
      return headers.map(header => result[header]?.value || '');
    });

    // Format as markdown table
    const headerRow = `| ${headers.join(' | ')} |`;
    const separatorRow = `| ${headers.map(() => '---').join(' | ')} |`;
    const dataRows = rows.map(row => `| ${row.join(' | ')} |`);

    return [headerRow, separatorRow, ...dataRows].join('\n');
  }
}
