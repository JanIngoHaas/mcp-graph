import { Quad } from "@rdfjs/types";

/**
 * Citation database for storing RDF triples with unique citation IDs
 */
export interface Citation {
    id: string;
    sessionId: string;
    quads: Quad[];
    createdAt: Date;
}

export class CitationDatabase {
    private citations: Map<string, Citation> = new Map();
    private sessionCitations: Map<string, Set<string>> = new Map();

    /**
     * Store triples and generate a unique citation ID (random UUID)
     * @param sessionId - The session ID that created this citation
     * @param quads - The RDF quads
     * @returns The unique citation ID
     */
    storeCitation(sessionId: string, quads: Quad[]): string {
        const citationId = crypto.randomUUID();

        this.citations.set(citationId, {
            id: citationId,
            sessionId,
            quads: quads,
            createdAt: new Date(),
        });

        // Track citation for session cleanup
        if (!this.sessionCitations.has(sessionId)) {
            this.sessionCitations.set(sessionId, new Set());
        }
        this.sessionCitations.get(sessionId)!.add(citationId);

        return citationId;
    }

    getCitationsForSession(sessionId: string): Citation[] {
        const citationIds = this.sessionCitations.get(sessionId);
        if (citationIds) {
            return Array.from(citationIds).map((id) => this.citations.get(id)!);
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
