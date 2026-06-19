import { cp, mkdir, rm, writeFile } from "node:fs/promises";

const outDir = "site";

await rm(outDir, { recursive: true, force: true });
await mkdir(`${outDir}/src/data`, { recursive: true });

await cp("index.html", `${outDir}/index.html`);
await cp("src/static-app.js", `${outDir}/src/static-app.js`);
await cp("src/static-styles.css", `${outDir}/src/static-styles.css`);
await cp("src/data/worldcup-data.js", `${outDir}/src/data/worldcup-data.js`);
await writeFile(`${outDir}/.nojekyll`, "");

console.log(`Prepared ${outDir}/ for GitHub Pages.`);
