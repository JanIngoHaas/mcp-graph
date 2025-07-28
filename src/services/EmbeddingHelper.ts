import { FeatureExtractionPipeline, pipeline } from "@huggingface/transformers";
import Logger from "../utils/logger.js";

export class EmbeddingHelper {
  private _embedder: FeatureExtractionPipeline | null = null;

  async init(): Promise<void> {
    if (this._embedder) {
      return; // Already initialized
    }

    Logger.info("Initializing embedding model (Qwen3-Embedding-0.6B)...");
    try {
      this._embedder = await pipeline(
        "feature-extraction",
        "onnx-community/Qwen3-Embedding-0.6B-ONNX",
        {
          device: "cpu",
          dtype: "fp32",
          progress_callback: (progress) => {
            if (progress.status === "progress") {
              Logger.debug(`Loading embedding model: ${progress.progress}`);
            }
          },
        }
      );
    } catch (err) {
      Logger.warn("Failed to initialize with device 'auto', retrying with 'cpu'...");
      this._embedder = await pipeline(
        "feature-extraction",
        "onnx-community/Qwen3-Embedding-0.6B-ONNX",
        {
          device: "cpu",
          dtype: "fp32",
          progress_callback: (progress) => {
            if (progress.status === "progress") {
              Logger.debug(`Loading embedding model: ${progress.progress}`);
            }
          },
        }
      );
    }
    Logger.info("Embedding model loaded successfully");
  }

  async embed(
    text: string[],
    instructionType: "query_class" | "query_property" | "none",
    onBatchComplete: (
      batchTexts: string[],
      embeddings: Float32Array[]
    ) => Promise<void>
  ): Promise<void> {
    await this.init();

    if (!this._embedder) {
      throw new Error("Failed to initialize embedding model");
    }

    // Format text with appropriate instruction based on type
    const formattedTexts = text.map((t) => {
      switch (instructionType) {
        case "query_class":
          return `Instruct: Given a web search query, retrieve relevant ontological classes from a knowledge graph.\nQuery: ${t}`;
        case "query_property":
          return `Instruct: Given a web search query, retrieve relevant ontological properties from a knowledge graph. Properties are formatted as [Domain]--[Property]-->[Range].\nQuery: ${t}`;
        case "none":
        default:
          return t;
      }
    });

    Logger.info(
      `Formatted texts for embedding: ${formattedTexts
        .map((t) => `"${t}"`)
        .join(", ")}`
    );

    const batchSize = parseInt(process.env.EMBEDDING_BATCH_SIZE || "32");

    for (let i = 0; i < formattedTexts.length; i += batchSize) {
      const batch = formattedTexts.slice(i, i + batchSize);
      const originalBatch = text.slice(i, i + batchSize);

      Logger.info(
        `Processing the following texts for embeddings:\n${batch.join("\n")}`
      );

      Logger.info(
        `Processing embedding batch ${
          Math.floor(i / batchSize) + 1
        }/${Math.ceil(formattedTexts.length / batchSize)} (${
          batch.length
        } texts)`
      );

      const result = await this._embedder(batch, {
        pooling: "last_token",
        normalize: true,
      });
      const resultList = result.tolist();

      // Convert 2D JS list to array of Float32Arrays
      const batchEmbeddings = resultList.map(
        (embedding: any, index: number) => {
          // Ensure embedding is a plain array of numbers
          const embeddingArray = Array.isArray(embedding)
            ? embedding
            : Array.from(embedding);
          const float32Array = new Float32Array(embeddingArray);

          Logger.info(
            `Generated embedding for "${originalBatch[index]}" - Dimensions: ${
              float32Array.length
            }, First 5 values: [${Array.from(float32Array.slice(0, 5))
              .map((v) => v.toFixed(4))
              .join(", ")}]`
          );

          return float32Array;
        }
      );

      await onBatchComplete(originalBatch, batchEmbeddings);
      result.dispose();
    }
  }
}
