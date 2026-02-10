/**
 * A recorded tool execution
 */
export interface ToolExecution {
    id: string;
    sessionId: string;
    toolName: string;
    params: Record<string, any>;
    createdAt: Date;
}

/**
 * A single step in an explanation trace
 */
export interface ExplanationStep {
    /** Human-readable description of what this step does */
    description: string;
    /** The execution key reference */
    executionKey: string;
    /** The tool that was used (denormalized for easy access) */
    toolName: string;
    /** Parameters (denormalized for easy access) */
    toolParams: Record<string, any>;
}

/**
 * A complete explanation with multiple steps
 */
export interface Explanation {
    id: string;
    sessionId: string;
    title: string;
    /** The final answer with embedded citation links */
    answer: string;
    /** Whether the agent found what the user asked for */
    found: boolean;
    steps: ExplanationStep[];
    createdAt: Date;
}

/**
 * Result of executing a single step
 */
export interface StepExecutionResult {
    success: boolean;
    result?: string;
    error?: string;
}

/**
 * Interface for step execution (implemented by ExplanationService)
 */
export interface StepExecutor {
    executeStep(explanationId: string, stepIndex: number): Promise<StepExecutionResult>;
}
