import { readFileSync } from "fs";
import { join } from "path";

const fragments = [
  "custom-config/cards/custom.css",
  "custom-config/extras/custom.css",
  "custom-config/radio/custom.css",
  "custom-config/radio/custom.js",
  "custom-config/particles/custom.css",
  "custom-config/particles/custom.js",
];

let failed = false;

for (const fragment of fragments) {
  const source = readFileSync(join(process.cwd(), fragment), "utf8");
  const starts = source.match(/HOMEPAGE-EDITOR .* START/g) ?? [];
  const ends = source.match(/HOMEPAGE-EDITOR .* END/g) ?? [];

  if (starts.length !== 1 || ends.length !== 1) {
    failed = true;
    console.error(`${fragment}: expected exactly one HOMEPAGE-EDITOR START and END marker`);
  }
}

if (failed) {
  process.exit(1);
}

console.log("Managed block markers look valid.");
