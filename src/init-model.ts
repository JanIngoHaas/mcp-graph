import { EmbeddingHelper } from "./services/EmbeddingHelper.js";
import Logger from "./utils/logger.js";

async function initModel(): Promise<void> {
  try {
    Logger.info("Initializing and downloading ONNX embedding model...");
    const embeddingHelper = new EmbeddingHelper();
    await embeddingHelper.init();
    Logger.info("ONNX model successfully downloaded and initialized!");
  } catch (error) {
    Logger.error("Failed to initialize ONNX model:", error);
    process.exit(1);
  }
}

initModel();