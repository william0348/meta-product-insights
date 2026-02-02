import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const STORAGE_DIR = path.join(__dirname, "../storage/csv_cache");
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

/**
 * Clean up CSV files older than 24 hours
 */
export async function cleanupOldCSVFiles(): Promise<{ deleted: number; errors: number }> {
  let deleted = 0;
  let errors = 0;

  try {
    // Ensure directory exists
    await fs.mkdir(STORAGE_DIR, { recursive: true });

    // Read all files in the directory
    const files = await fs.readdir(STORAGE_DIR);

    const now = Date.now();

    for (const file of files) {
      // Only process CSV files
      if (!file.endsWith(".csv")) {
        continue;
      }

      try {
        const filePath = path.join(STORAGE_DIR, file);
        const stats = await fs.stat(filePath);

        // Check if file is older than 24 hours
        const fileAge = now - stats.mtimeMs;

        if (fileAge > MAX_AGE_MS) {
          await fs.unlink(filePath);
          deleted++;
          console.log(`[CSV Cleanup] Deleted old file: ${file} (age: ${Math.round(fileAge / 1000 / 60 / 60)}h)`);
        }
      } catch (error: any) {
        errors++;
        console.error(`[CSV Cleanup] Error processing file ${file}:`, error.message);
      }
    }

    console.log(`[CSV Cleanup] Completed: ${deleted} files deleted, ${errors} errors`);
  } catch (error: any) {
    console.error("[CSV Cleanup] Failed to read storage directory:", error.message);
    errors++;
  }

  return { deleted, errors };
}

// If run directly (not imported), execute cleanup
if (import.meta.url === `file://${process.argv[1]}`) {
  cleanupOldCSVFiles()
    .then(({ deleted, errors }) => {
      console.log(`Cleanup complete: ${deleted} deleted, ${errors} errors`);
      process.exit(errors > 0 ? 1 : 0);
    })
    .catch((error) => {
      console.error("Cleanup failed:", error);
      process.exit(1);
    });
}
