import "dotenv/config";
import { EmbeddingHelper } from "./services/EmbeddingHelper.js";
import Logger from "./utils/logger.js";

async function initModel(): Promise<void> {
  try {
    Logger.info("Initializing and downloading ONNX embedding model...");
    Logger.info("This may take several minutes on first run (downloading ~2.5GB)...");

    const embeddingHelper = new EmbeddingHelper();
    await embeddingHelper.init();

    Logger.info("ONNX model successfully downloaded and initialized!");
    process.exit(0);
  } catch (error) {
    Logger.error("Failed to initialize ONNX model:", error);
    Logger.error("If download was interrupted, try clearing cache: rm -rf node_modules/@huggingface/transformers/.cache");
    process.exit(1);
  }
}

initModel();