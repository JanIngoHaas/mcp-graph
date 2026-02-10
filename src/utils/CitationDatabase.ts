import { Quad } from "@rdfjs/types";
import { QueryBuilderResult } from "../types/index.js";
import { generateHumanId } from "./humanId.js";

/**
 * Citation for RDF triples
 */
export interface TripleCitation {
    type: 'triple';
    id: string;
    sessionId: string;
    quads: Quad[];
    createdAt: Date;
    isActive: boolean;
}

/**
 * Citation for queries
 */
export interface QueryBuilderCitation {
    type: 'queryBuilder';
    id: string;
    sessionId: string;
    result: QueryBuilderResult;
    description: string;
    createdAt: Date;
    isActive: boolean;
}

/**
 * Union type for all citation types
 */
export type Citation = TripleCitation | QueryBuilderCitation;

export class CitationDatabase {
    private citations: Map<string, Citation> = new Map();
    private sessionCitations: Map<string, Set<string>> = new Map();


    private storeGenericCitation(citation: Citation, citationId: string): string {
        this.citations.set(citationId, citation);

        // Track citation for session cleanup
        if (!this.sessionCitations.has(citation.sessionId)) {
            this.sessionCitations.set(citation.sessionId, new Set());
        }
        this.sessionCitations.get(citation.sessionId)!.add(citationId);

        return citationId;
    }

    private generateId(preferredId?: string): string {
        if (preferredId) {
            if (this.citations.has(preferredId)) {
                throw new Error(`Citation ID already exists: ${preferredId}`);
            }
            return preferredId;
        }

        for (let attempt = 0; attempt < 10; attempt += 1) {
            const id = generateHumanId(4);
            if (!this.citations.has(id)) return id;
        }
        throw new Error("Failed to generate unique citation ID");
    }

    /**
     * Store triples and generate a unique citation ID (human-readable)
     * @param sessionId - The session ID that created this citation
     * @param quads - The RDF quads
     * @returns The unique citation ID
     */
    storeCitation(sessionId: string, quads: Quad[], preferredId?: string): string {
        const citationId = this.generateId(preferredId);

        const citation: TripleCitation = {
            type: 'triple',
            id: citationId,
            sessionId,
            quads,
            createdAt: new Date(),
            isActive: false
        };

        return this.storeGenericCitation(citation, citationId);
    }

    /**
     * Store a query builder result and generate a unique citation ID
     * @param sessionId - The session ID that created this citation
     * @param result - The query builder result
     * @param description - Human-readable description of the query
     * @returns The unique citation ID
     */
    storeQueryBuilderCitation(
        sessionId: string,
        result: QueryBuilderResult,
        description: string,
        preferredId?: string
    ): string {
        const citationId = this.generateId(preferredId);

        const citation: QueryBuilderCitation = {
            type: 'queryBuilder',
            id: citationId,
            sessionId,
            result,
            description,
            createdAt: new Date(),
            isActive: false
        };

        return this.storeGenericCitation(citation, citationId);
    }

    /**
     * Activate a citation by ID
     * @param citationId - The citation ID
     * @returns true if activated, false if not found
     */
    activateCitation(citationId: string): boolean {
        const citation = this.citations.get(citationId);
        if (citation) {
            citation.isActive = true;
            return true;
        }
        return false;
    }

    /**
     * Get all active citations for a session
     * @param sessionId - The session ID
     * @returns List of active citations
     */
    getCitationsForSession(sessionId: string): Citation[] {
        const citationIds = this.sessionCitations.get(sessionId);
        if (citationIds) {
            return Array.from(citationIds)
                .map((id) => this.citations.get(id)!)
                .filter(citation => citation.isActive);
        }
        return [];
    }

    /**
     * Retrieve a citation by ID
     * @param citationId - The citation ID
     * @returns The citation or undefined if not found
     */
    getCitation(citationId: string): Citation | undefined {
        return this.citations.get(citationId);
    }

    /**
     * Remove all citations for a session
     * @param sessionId - The session ID to clean up
     */
    cleanupSession(sessionId: string): void {
        const citationIds = this.sessionCitations.get(sessionId);
        if (citationIds) {
            for (const id of citationIds) {
                this.citations.delete(id);
            }
            this.sessionCitations.delete(sessionId);
        }
    }

    /**
     * Get total number of citations
     */
    get size(): number {
        return this.citations.size;
    }
}
