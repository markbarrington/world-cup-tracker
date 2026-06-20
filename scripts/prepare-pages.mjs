import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const outDir = "site";
const execFileAsync = promisify(execFile);

async function versionToken() {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"]);
    return stdout.trim();
  } catch {
    return String(Date.now());
  }
}

await rm(outDir, { recursive: true, force: true });
await mkdir(`${outDir}/src/data`, { recursive: true });

const version = await versionToken();
const index = await readFile("index.html", "utf8");
await writeFile(
  `${outDir}/index.html`,
  index
    .replace("./src/static-styles.css", `./src/static-styles.css?v=${version}`)
    .replace("./src/data/worldcup-data.js", `./src/data/worldcup-data.js?v=${version}`)
    .replace("./src/static-app.js", `./src/static-app.js?v=${version}`),
);
await cp("src/static-app.js", `${outDir}/src/static-app.js`);
await cp("src/static-styles.css", `${outDir}/src/static-styles.css`);
await cp("src/data/worldcup-data.js", `${outDir}/src/data/worldcup-data.js`);
await writeFile(`${outDir}/.nojekyll`, "");

console.log(`Prepared ${outDir}/ for GitHub Pages.`);
