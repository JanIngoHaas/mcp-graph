import { QueryService } from "./QueryService.js";
import { SearchService } from "./SearchService.js";
import { InspectionService } from "./InspectionService.js";
import { TripleService } from "./TripleService.js";
import { QueryBuilderService } from "./QueryBuilderService.js";
import { ExplanationDatabase } from "../utils/ExplanationDatabase.js";
import type {
    ExplanationStep,
    StepExecutionResult,
    StepExecutor
} from "../types/index.js";
import { formatInspectionForUser, formatResourceResultForUser, formatTriplesForUser, formatQueryBuilderResultForUser } from "../utils/formatting/index.js";

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
        steps: ExplanationStep[],
        success: boolean
    ): string {
        return this.explanationDb.storeExplanation(sessionId, title, answer, steps, success);
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
                return formatResourceResultForUser(results);
            }

            case "inspect": {
                const result = await this.inspectionService.inspect(
                    params.uri,
                    params.expandProperties || []
                );
                // Use user-friendly formatting for explanation pages
                return formatInspectionForUser(result);
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
                // Format as user-friendly text
                return formatTriplesForUser(quads);
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
                return `${description}\n\n${formatQueryBuilderResultForUser(result)}`;
            }

            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }
}
