import { QueryService } from "./QueryService.js";
import { SearchService } from "./SearchService.js";
import { InspectionService } from "./InspectionService.js";
import { TripleService } from "./TripleService.js";
import { QueryBuilderService } from "./QueryBuilderService.js";
import {
    ExplanationDatabase,
    ExplanationStep,
    StepExecutionResult,
    StepExecutor
} from "../utils/ExplanationDatabase.js";

/**
 * Service for executing explanation steps.
 * Uses ExplanationDatabase for storage and implements StepExecutor for execution.
 * Created internally in createServer(), registers itself with the database.
 */
export class ExplanationService implements StepExecutor {
    constructor(
        private explanationDb: ExplanationDatabase,
        private searchService: SearchService,
        private inspectionService: InspectionService,
        private tripleService: TripleService,
        private queryBuilderService: QueryBuilderService,
        private sparqlEndpoint: string
    ) {
        // Register this service as the executor for the database
        this.explanationDb.setExecutor(this);
    }

    /**
     * Store a new explanation (delegates to database)
     */
    storeExplanation(
        sessionId: string,
        title: string,
        answer: string,
        steps: ExplanationStep[]
    ): string {
        return this.explanationDb.storeExplanation(sessionId, title, answer, steps);
    }

    /**
     * Re-execute a specific step and return the result
     */
    async executeStep(
        explanationId: string,
        stepIndex: number
    ): Promise<StepExecutionResult> {
        const explanation = this.explanationDb.getExplanation(explanationId);
        if (!explanation) {
            return { success: false, error: "Explanation not found" };
        }

        if (stepIndex < 0 || stepIndex >= explanation.steps.length) {
            return { success: false, error: "Invalid step index" };
        }

        const step = explanation.steps[stepIndex];

        try {
            const result = await this.executeToolCall(step.toolName, step.toolParams);
            return { success: true, result };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Execute a tool call with the given parameters
     */
    private async executeToolCall(
        toolName: ExplanationStep["toolName"],
        params: Record<string, any>
    ): Promise<string> {
        switch (toolName) {
            case "search": {
                const results = await this.searchService.searchAll(
                    params.query,
                    this.sparqlEndpoint,
                    params.limit || 20,
                    params.offset || 0
                );
                return this.searchService.renderResourceResult(results);
            }

            case "inspect": {
                return await this.inspectionService.inspect(
                    params.uri,
                    params.expandProperties || [],
                    params.relevantToQuery || "",
                    params.maxResults || 15
                );
            }

            case "fact": {
                const quads = await this.tripleService.completeTriple(
                    params.subject,
                    params.predicate,
                    params.object,
                    params.limit || 100
                );
                if (quads.length === 0) {
                    return "No matching triples found.";
                }
                // Format as simple text representation
                return quads
                    .map((q) => `${q.subject.value} → ${q.predicate.value} → ${q.object.value}`)
                    .join("\n");
            }

            case "query_builder": {
                const result = await this.queryBuilderService.executeQuery({
                    type: params.type,
                    filters: params.filters,
                    project: params.project,
                    limit: params.limit || 100,
                });
                const description = await this.queryBuilderService.generateDescription({
                    type: params.type,
                    filters: params.filters,
                    project: params.project,
                    limit: params.limit,
                });
                return `${description}\n\nFound ${result.count} results:\n${result.quads
                    .slice(0, 20)
                    .map((q) => `${q.subject.value} → ${q.predicate.value} → ${q.object.value}`)
                    .join("\n")}${result.count > 20 ? `\n... and ${result.count - 20} more` : ""}`;
            }

            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }
}
