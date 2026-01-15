import { QueryService } from "./QueryService";
import { ResourceResult } from "../types";
import { QueryParserService, FallbackBackend, QLeverBackend } from "../utils/queryParser.js";
import { PrefixManager } from "../utils/PrefixManager.js";

export class SearchService {
  private queryService: QueryService;
  private queryParser: QueryParserService;

  constructor(queryService: QueryService, searchBackend?: string) {
    this.queryService = queryService;

    // Default to Fallback (universal), allow override to QLever
    let backend;
    switch (searchBackend) {
      case 'qlever':
        backend = new QLeverBackend();
        break;
      default:
        backend = new FallbackBackend();
        break;
    }

    this.queryParser = new QueryParserService(backend);
  }

  public getQueryParser(): QueryParserService {
    return this.queryParser;
  }

  public async searchAll(
    searchQuery: string,
    sparqlEndpoint: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<ResourceResult[]> {
    if (!sparqlEndpoint) {
      throw new Error("SPARQL endpoint not configured for search");
    }

    let query = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX textSearch: <https://qlever.cs.uni-freiburg.de/textSearch/>
      
      SELECT DISTINCT * WHERE {
        ?resource ?textProp ?searchText .
        ${this.queryParser.parseAndGeneratePattern(searchQuery, "?searchText")}
      }
      ORDER BY ?resource
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const results = await this.queryService.executeQueryRaw(query, [
      sparqlEndpoint,
    ]);

    return results
      .map((binding: any) => {
        const uri = binding.resource?.value || "";
        const textProp = binding.textProp?.value || "";
        const searchText = binding.searchText?.value || "";
        return {
          uri,
          textProp,
          searchText,
        };
      })
      .filter((result) => result.uri); // Filter out empty URIs
  }

  public renderResourceResult(results: ResourceResult[]): string {
    if (results.length === 0) {
      return "No entities found matching your search query. Try different keywords or check if the entities exist in the knowledge graph.";
    }

    let response = `## Found ${results.length} entities\n\n`;
    response += "| URI | Property | Matching Text |\n";
    response += "|-----|----------|---------------|\n";
    const TEXT_LENTH_LIMIT = 1024;
    results.forEach((result: ResourceResult) => {
      const uri = result.uri.replace(/\|/g, "\\|");
      const textProp = (result.textProp || "").replace(/\|/g, "\\|");
      const searchText = result.searchText
        ? (result.searchText.length > TEXT_LENTH_LIMIT
          ? result.searchText.substring(0, 255) + "..."
          : result.searchText).replace(/\|/g, "\\|").replace(/\n/g, " ")
        : "";

      response += `| ${uri} | ${textProp} | ${searchText} |\n`;
    });

    response += "\n*Use `inspect` tool with any URI above for detailed information*";
    const prefixManager = PrefixManager.getInstance();
    response = prefixManager.compressTextWithPrefixes(response);
    return response;
  }
}
