import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import peggy from "peggy";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class PathParser {
    private parser: any;

    constructor() {
        this.initializeParser();
    }

    private initializeParser() {
        try {
            const grammarPath = join(__dirname, '../grammar/path.pegjs');
            const grammar = readFileSync(grammarPath, 'utf8');
            this.parser = peggy.generate(grammar);
        } catch (error) {
            console.error('Failed to load path grammar:', error);
            throw new Error('Path Parser initialization failed');
        }
    }

    public parse(path: string): string[] {
        try {
            return this.parser.parse(path.trim());
        } catch (error) {
            throw new Error(`Path parse error: ${(error as Error).message}`);
        }
    }
}
