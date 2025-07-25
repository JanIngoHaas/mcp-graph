import { QueryEngine } from "@comunica/query-sparql";
import { QueryStringContext } from "@comunica/types";

export class QueryService {
  private queryEngine: QueryEngine;

  constructor() {
    this.queryEngine = new QueryEngine();
  }

  async executeQuery(query: string, sources: Array<string>): Promise<any[]> {
    // Rate limiting: 100ms delay before each query
    await new Promise((resolve) => setTimeout(resolve, 100));

    const bindingsStream = await this.queryEngine.queryBindings(query, {
      sources,
    } as QueryStringContext);

    const bindings = await bindingsStream.toArray();
    return bindings.map((binding) => {
      const result: any = {};
      for (const [variable, term] of binding) {
        result[variable.value] = {
          value: term.value,
          type: term.termType,
        };
      }
      return result;
    });
  }
}
