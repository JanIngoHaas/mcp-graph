import { FeatureExtractionPipeline, pipeline } from "@huggingface/transformers";
import Logger from "../utils/logger.js";

export class EmbeddingHelper {
  private _embedder: FeatureExtractionPipeline | null = null;

  async embed(
    text: string[],
    instruction: boolean,
    onBatchComplete: (
      batchTexts: string[],
      embeddings: Float32Array[]
    ) => Promise<void>
  ): Promise<void> {
    if (!this._embedder) {
      Logger.info("Initializing embedding model (Qwen3-Embedding-0.6B)...");
      this._embedder = await pipeline(
        "feature-extraction",
        "onnx-community/Qwen3-Embedding-0.6B-ONNX",
        {
          device: "auto",
          dtype: "fp32",
          progress_callback: (progress) => {
            if (progress.status === "progress") {
              Logger.debug(`Loading embedding model: ${progress.progress}`);
            }
          },
        }
      );
      Logger.info("Embedding model loaded successfully");
    }

    // Format text with instruction if provided (instruction-aware embeddings)
    const formattedTexts = text.map((t) => {
      if (instruction) {
        return `Instruct: Given a web search query, retrieve semantically similar class and property definitions from an RDF knowledge graph.\nQuery: ${t}`;
      }
      return t;
    });

    const batchSize = parseInt(process.env.EMBEDDING_BATCH_SIZE || "32");

    for (let i = 0; i < formattedTexts.length; i += batchSize) {
      const batch = formattedTexts.slice(i, i + batchSize);
      const originalBatch = text.slice(i, i + batchSize);

      Logger.info(
        `Processing embedding batch ${
          Math.floor(i / batchSize) + 1
        }/${Math.ceil(formattedTexts.length / batchSize)} (${
          batch.length
        } texts)`
      );

      const result = await this._embedder(batch, {
        pooling: "mean",
        normalize: true,
      });
      const resultList = result.tolist();

      // Convert 2D JS list to array of Float32Arrays
      const batchEmbeddings = resultList.map((embedding: any) => {
        // Ensure embedding is a plain array of numbers
        const embeddingArray = Array.isArray(embedding)
          ? embedding
          : Array.from(embedding);
        return new Float32Array(embeddingArray);
      });

      result.dispose();
      // Call the callback to store embeddings immediately
      await onBatchComplete(originalBatch, batchEmbeddings);
    }
  }
}
