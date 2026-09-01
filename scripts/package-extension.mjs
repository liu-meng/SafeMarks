import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const distDir = path.join(rootDir, "dist");
const manifestPath = path.join(rootDir, "manifest.json");
const releaseEntries = [
  "manifest.json",
  "_locales",
  "assets",
  "src"
];

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      ...options
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function assertReleaseEntriesExist() {
  for (const entry of releaseEntries) {
    await stat(path.join(rootDir, entry));
  }
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const packageBaseName = `safemarks-${manifest.version}`;
  const stageDir = path.join(distDir, packageBaseName);
  const zipFilename = `${packageBaseName}.zip`;
  const zipPath = path.join(distDir, zipFilename);

  await assertReleaseEntriesExist();
  await rm(distDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });

  for (const entry of releaseEntries) {
    await cp(path.join(rootDir, entry), path.join(stageDir, entry), {
      recursive: true
    });
  }

  await runCommand("zip", ["-qr", zipFilename, packageBaseName, "-x", "*/.DS_Store"], {
    cwd: distDir
  });

  await rm(stageDir, { recursive: true, force: true });

  console.log(`Created ${path.relative(rootDir, zipPath)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
