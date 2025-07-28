import * as os from "os";
import * as path from "path";

export function getCacheDirectory(): string {
  const platform = os.platform();
  const homedir = os.homedir();

  switch (platform) {
    case "win32":
      return process.env.LOCALAPPDATA || path.join(homedir, "AppData", "Local");
    case "darwin":
      return path.join(homedir, "Library", "Caches");
    case "linux":
    default:
      return process.env.XDG_CACHE_HOME || path.join(homedir, ".cache");
  }
}

export function resolveCachePath(dbPath: string): string {
  if (dbPath === ":cache:") {
    const cacheDir = getCacheDirectory();
    return path.join(cacheDir, "mcp-graph", "ontology.db");
  }
  return dbPath;
}
