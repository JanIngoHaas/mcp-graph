import { QueryService } from "./QueryService.js";
import { EmbeddingHelper } from "./EmbeddingHelper.js";
import { PrefixManager } from "../utils/PrefixManager.js";
import { cos_sim } from "@huggingface/transformers";

interface Step {
  from: string;
  property: string;
  to: string;
}

interface Path {
  depth: number;
  steps: Step[];
  score?: number;
}

interface TreeNode {
  uri: string;
  children: Map<string, TreeNode>; // property -> node
  isTarget: boolean;
}

export class PathExplorationService {
  private queryService: QueryService;
  private embeddingHelper: EmbeddingHelper;
  private sparqlEndpoint: string;
  private static readonly DEPTH_BIAS_FACTOR = 0.15;

  constructor(queryService: QueryService, sparqlEndpoint: string, embeddingHelper: EmbeddingHelper) {
    this.queryService = queryService;
    this.embeddingHelper = embeddingHelper;
    this.sparqlEndpoint = sparqlEndpoint;
  }

  private generatePathQuery(sourceUri: string, targetUri: string, maxDepth: number = 5): string {
    const unions = [];
    const target = `?n${maxDepth}`;
    const source = `?n0`;
    const targetBound = `BIND(<${targetUri}> AS ${target}).`;
    const sourceBound = `BIND(<${sourceUri}> AS ${source}).`;
    for (let depth = 1; depth <= maxDepth; depth++) {
      let selectVars = [];
      let whereClause = "";
        let filters = [];
      
      for (let i = 1; i <= depth; i++) {
        selectVars.push(`?p${i}`);
        if (i < depth) {
          selectVars.push(`?n${i}`);
        }
      }
      selectVars.push(`(${depth} AS ?depth)`);
      
      if (depth === 1) {
        whereClause = `${source} ?p1 ${target} .`;
      } else {
        let clauses = [`${source} ?p1 ?n1 .`];
        for (let i = 2; i <= depth; i++) {
          clauses.push(`?n${i-1} ?p${i} ?n${i} .`);
        }
        whereClause = clauses.join('\n        ');
        
        // Remove backward edges:
        /*
          dbr:Steve_Jobs
        ├── [dbo:board]
        │   └── dbr:Apple_Inc. ★
        ├── [dbo:wikiPageWikiLink]
        │   └── dbr:Apple_Inc. ★
        │       └── [dbo:wikiPageWikiLink]
        │           └── dbr:Apple_Inc. ★
        
        the backward edge is redundant information!

        Idea: For every depth UNION, we check that a pair (pN, nN+1) has not occurred before in the path.
        How: for every smaller i < N, we check that (pN, nN+1) != (pI, nI+1)

        */

        // TODO: Anti-cycle filters from template --- Think about how to best implement this
        // for (let i = 1; i < depth; i++) {
        //   for (let j = i + 1; j <= depth; j++) {
        //     if (i === 1 && j === depth) {
        //       filters.push(`FILTER(<${sourceUri}> != ?n${i} || ?p${i} != ?p${j} || ?n${i} != <${targetUri}>)`);
        //     } else if (i === 1) {
        //       filters.push(`FILTER(<${sourceUri}> != ?n${j-1} || ?p${i} != ?p${j} || ?n${i} != ?n${j-1})`);
        //     } else if (j === depth) {
        //       filters.push(`FILTER(?n${i-1} != ?n${j-1} || ?p${i} != ?p${j} || ?n${i} != <${targetUri}>)`);
        //     } else {
        //       filters.push(`FILTER(?n${i-1} != ?n${j-1} || ?p${i} != ?p${j} || ?n${i} != ?n${j-1})`);
        //     }
        //   }
        // }
      }
      
      let union = `    {
      SELECT ${selectVars.join(' ')} WHERE {
        ${sourceBound} ${targetBound} ${whereClause}`;
      
      // if (filters.length > 0) {
      //   union += `\n        ${filters.join('\n        ')}`;
      // }
      
      union += `
      }
    }`;
      unions.push(union);
    }
    
    return `SELECT DISTINCT ${Array.from({length: maxDepth}, (_, i) => `?p${i+1} ?n${i+1}`).join(' ')} ?depth
WHERE {
${sourceBound}
${targetBound}
${unions.join('\n    UNION\n')}
}
ORDER BY ?depth`;
  }

  async explore(
    sourceUri: string, 
    targetUri: string, 
    relevantToQuery: string,
    topN: number = 20,
    maxDepth: number = 5
  ): Promise<string> {
    const query = this.generatePathQuery(sourceUri, targetUri, maxDepth);
    
    try {
      const results = await this.queryService.executeQueryRaw(query, [this.sparqlEndpoint]);
      
      if (results.length === 0) {
        return `No paths found between:\n- ${sourceUri}\n- ${targetUri}`;
      }
      
      // Parse results into paths with step structure
      const paths: Path[] = results.map(result => {
        const depth = parseInt(result.depth?.value || "0");
        const steps: Step[] = [];
        
        let currentNode = sourceUri;
        
        for (let i = 1; i <= depth; i++) {
          const property = result[`p${i}`]?.value;
          const nextNode = i < depth 
            ? result[`n${i}`]?.value 
            : targetUri;
            
          if (property && nextNode) {
            steps.push({
              from: currentNode,
              property: property,
              to: nextNode
            });
            currentNode = nextNode;
          }
        }
        
        return { depth, steps };
      }).filter(path => path.steps.length > 0);

      // Score and filter paths by semantic relevance
      const scoredPaths = await this.scoreAndFilterPaths(paths, relevantToQuery, topN);
      
      // Build and render tree from top N paths
      const tree = this.buildTree(scoredPaths, sourceUri, targetUri);
      return this.renderTree(tree, sourceUri, targetUri, scoredPaths.length, paths.length);
      
    } catch (error) {
      console.error(`Error finding paths:`, error);
      return `Error finding paths: ${error}`;
    }
  }

  private async scoreAndFilterPaths(
    paths: Path[],
    relevantToQuery: string,
    topN: number
  ): Promise<Path[]> {
    if (paths.length === 0) return [];

    // Get query embedding once for all paths
    const queryEmbedding: Float32Array[] = [];
    await this.embeddingHelper.embed([relevantToQuery], "query_property", async (_, embeddings) => {
      queryEmbedding.push(...embeddings);
    });

    if (queryEmbedding.length === 0) {
      // Fallback to depth-based sorting if embedding fails
      return paths.sort((a, b) => a.depth - b.depth).slice(0, topN);
    }

    // Score each path using the cached query embedding
    const scoredPaths = await Promise.all(
      paths.map(async (path) => {
        const relevanceScore = await this.calculatePathRelevance(path, queryEmbedding[0]);
        const rawScore = relevanceScore + PathExplorationService.DEPTH_BIAS_FACTOR / path.depth;
        return { ...path, score: rawScore };
      })
    );

    // Apply softmax to get probabilities
    const expScores = scoredPaths.map(p => Math.exp(p.score!));
    const sumExp = expScores.reduce((sum, exp) => sum + exp, 0);
    
    const probabilityPaths = scoredPaths.map((path, i) => ({
      ...path,
      score: expScores[i] / sumExp
    }));

    // Sort by probability and take top N
    return probabilityPaths
      .sort((a, b) => b.score! - a.score!)
      .slice(0, topN);
  }

  private async calculatePathRelevance(path: Path, queryEmbedding: Float32Array): Promise<number> {
    // Collect all step texts for this path
    const stepTexts = path.steps.map(step => `${step.from} ${step.property} ${step.to}`);
    
    // Get embeddings for all steps in one batch
    const stepEmbeddings: Float32Array[] = [];
    await this.embeddingHelper.embed(stepTexts, "none", async (_, embeddings) => {
      stepEmbeddings.push(...embeddings);
    });

    if (stepEmbeddings.length !== stepTexts.length) {
      throw new Error(`Failed to get embeddings for path steps: expected ${stepTexts.length}, got ${stepEmbeddings.length}`);
    }

    // Calculate similarity for each step
    const stepScores = stepEmbeddings.map(stepEmb => 
      cos_sim(Array.from(stepEmb), Array.from(queryEmbedding))
    );

    return stepScores.reduce((sum, score) => sum + score, 0) / stepScores.length;
  }

  private buildTree(paths: Path[], sourceUri: string, targetUri: string): TreeNode {
    const root: TreeNode = {
      uri: sourceUri,
      children: new Map(),
      isTarget: sourceUri === targetUri
    };
    
    // Sort paths by depth (closest first)
    const sortedPaths = paths.sort((a, b) => a.depth - b.depth);
    
    for (const path of sortedPaths) {
      let currentNode = root;
      
      for (const step of path.steps) {
        if (!currentNode.children.has(step.property)) {
          currentNode.children.set(step.property, {
            uri: step.to,
            children: new Map(),
            isTarget: step.to === targetUri
          });
        }
        currentNode = currentNode.children.get(step.property)!;
      }
    }
    
    return root;
  }

  private renderTree(root: TreeNode, sourceUri: string, targetUri: string, selectedPaths: number, totalPaths: number): string {
    let output = `# Path Tree: ${sourceUri} → ${targetUri}\n\n`;
    output += `Showing top ${selectedPaths} most relevant paths (from ${totalPaths} found):\n\n`;
    output += `\`\`\`\n`;
    output += this.renderTreeNode(root, "", true, targetUri);
    output += `\`\`\`\n`;
    
    // Compress URIs and add prefix declarations
    const prefixManager = PrefixManager.getInstance();
    return prefixManager.compressTextWithPrefixes(output);
  }

  private renderTreeNode(node: TreeNode, prefix: string, isLast: boolean, targetUri: string): string {
    let result = "";
    
    if (prefix === "") {
      // Root node
      result += `${node.uri}\n`;
    } else {
      // Child node
      const connector = isLast ? "└── " : "├── ";
      const marker = node.isTarget ? " ★" : "";
      result += `${prefix}${connector}${node.uri}${marker}\n`;
    }
    
    // Sort children by minimum depth to target (closest first)
    const children = Array.from(node.children.entries()).sort((a, b) => {
      const depthA = this.getMinDepthToTarget(a[1], targetUri);
      const depthB = this.getMinDepthToTarget(b[1], targetUri);
      return depthA - depthB;
    });
    
    for (let i = 0; i < children.length; i++) {
      const [property, childNode] = children[i];
      const isLastChild = i === children.length - 1;
      const childPrefix = prefix + (isLast ? "    " : "│   ");
      
      result += `${childPrefix}${isLastChild ? "└── " : "├── "}[${property}]\n`;
      const nodePrefix = childPrefix + (isLastChild ? "    " : "│   ");
      result += this.renderTreeNode(childNode, nodePrefix, true, targetUri);
    }
    
    return result;
  }

  private getMinDepthToTarget(node: TreeNode, targetUri: string): number {
    if (node.isTarget) return 0;
    
    let minDepth = Infinity;
    for (const [_, child] of node.children) {
      const childDepth = this.getMinDepthToTarget(child, targetUri);
      if (childDepth < minDepth) {
        minDepth = childDepth;
      }
    }
    
    return minDepth === Infinity ? Infinity : minDepth + 1;
  }
}