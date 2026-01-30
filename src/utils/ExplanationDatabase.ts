import type {
    ToolExecution,
    ExplanationStep,
    Explanation,
    StepExecutionResult,
    StepExecutor
} from "../types/index.js";

/**
 * Database for storing and retrieving explanations.
 * Similar to CitationDatabase - created in index.ts, passed to createServer().
 * The executor is set later by ExplanationService (late binding).
 */
export class ExplanationDatabase {
    private explanations: Map<string, Explanation> = new Map();
    private sessionExplanations: Map<string, Set<string>> = new Map();
    private executions: Map<string, ToolExecution> = new Map();
    private executor?: StepExecutor;

    /**
     * Set the executor for step execution (called by ExplanationService)
     */
    setExecutor(executor: StepExecutor): void {
        this.executor = executor;
    }

    /**
     * Log a tool execution and return its ID
     */
    logExecution(
        sessionId: string,
        toolName: string,
        params: Record<string, any>
    ): string {
        const id = crypto.randomUUID();
        const execution: ToolExecution = {
            id,
            sessionId,
            toolName,
            params,
            createdAt: new Date()
        };
        this.executions.set(id, execution);
        return id;
    }

    /**
     * Get a tool execution by ID
     */
    getExecution(id: string): ToolExecution | undefined {
        return this.executions.get(id);
    }

    /**
     * Store a new explanation and return its ID
     */
    storeExplanation(
        sessionId: string,
        title: string,
        answer: string,
        steps: ExplanationStep[],
        success: boolean
    ): string {
        const id = crypto.randomUUID();

        const explanation: Explanation = {
            id,
            sessionId,
            title,
            answer,
            success,
            steps,
            createdAt: new Date(),
        };

        this.explanations.set(id, explanation);

        // Track for session cleanup
        if (!this.sessionExplanations.has(sessionId)) {
            this.sessionExplanations.set(sessionId, new Set());
        }
        this.sessionExplanations.get(sessionId)!.add(id);

        return id;
    }

    /**
     * Get an explanation by ID
     */
    getExplanation(id: string): Explanation | undefined {
        return this.explanations.get(id);
    }

    /**
     * Get all explanations for a session
     */
    getExplanationsForSession(sessionId: string): Explanation[] {
        const ids = this.sessionExplanations.get(sessionId);
        if (!ids) return [];
        return Array.from(ids)
            .map((id) => this.explanations.get(id)!)
            .filter(Boolean);
    }

    /**
     * Execute a step (delegates to the registered executor)
     */
    async executeStep(
        explanationId: string,
        stepIndex: number
    ): Promise<StepExecutionResult> {
        if (!this.executor) {
            return { success: false, error: "No executor registered" };
        }
        return this.executor.executeStep(explanationId, stepIndex);
    }

    /**
     * Clean up explanations for a session
     */
    cleanupSession(sessionId: string): void {
        const ids = this.sessionExplanations.get(sessionId);
        if (ids) {
            for (const id of ids) {
                this.explanations.delete(id);
            }
            this.sessionExplanations.delete(sessionId);
        }
    }

    /**
     * Get total number of explanations
     */
    get size(): number {
        return this.explanations.size;
    }
}
