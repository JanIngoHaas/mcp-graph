import { randomInt } from "crypto";
import { WORDLIST } from "./wordlist.js";

export function generateHumanId(wordCount = 4): string {
    if (!Number.isInteger(wordCount) || wordCount <= 0) {
        throw new Error("wordCount must be a positive integer");
    }
    const parts: string[] = new Array(wordCount);
    for (let i = 0; i < wordCount; i += 1) {
        parts[i] = WORDLIST[randomInt(WORDLIST.length)];
    }
    return parts.join("-");
}
