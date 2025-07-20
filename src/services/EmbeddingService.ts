import { FeatureExtractionPipeline, pipeline } from "@huggingface/transformers";

export class EmbeddingService {
  private _embedder: FeatureExtractionPipeline | null = null;

  async embed(text: string[], instruction?: string): Promise<Array<Float32Array>> {
    if (!this._embedder) {
      console.error('Initializing embedding model (Qwen3-Embedding-0.6B)...');
      try {
        // Try CUDA first
        this._embedder = await pipeline('feature-extraction', 'onnx-community/Qwen3-Embedding-0.6B-ONNX', {
          device: 'gpu',
        });
        console.error('Embedding model loaded successfully on GPU');
      } catch (error) {
        // Fallback to CPU
        console.error('GPU not available, falling back to CPU...');
        this._embedder = await pipeline('feature-extraction', 'onnx-community/Qwen3-Embedding-0.6B-ONNX');
        console.error('Embedding model loaded successfully on CPU');
      }
    }

    // Format text with instruction if provided (instruction-aware embeddings)
    const formattedTexts = text.map(t => {
      if (instruction) {
        return `Instruct: ${instruction}\nQuery: ${t}`;
      }
      return t;
    });

    // Process all texts in a single batch for better performance
    const result = await this._embedder(formattedTexts, {
      pooling: 'mean',
      normalize: true
    });
    const resultList = result.tolist();

    // Convert 2D JS list to array of Float32Arrays
    const embeddings = resultList.map((embedding: number[]) => new Float32Array(embedding));
    return embeddings;
  }
}