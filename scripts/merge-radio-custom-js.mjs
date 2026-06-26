import { readFileSync, writeFileSync } from "fs";
import { pathToFileURL } from "url";

const templateLiteralNames = ["stationList", "ipProviderList", "radioButtonsOrder"];
const simpleConstPatterns = [
  { name: "ipHideOnError", value: "(?:true|false)" },
  { name: "radioButtonsStyle", value: String.raw`(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')` },
  { name: "radioIconSize", value: String.raw`\d+` },
  { name: "radioButtonSize", value: String.raw`\d+` },
  { name: "linkIpFpsSizes", value: "(?:true|false)" },
  { name: "radioEnabled", value: "(?:true|false)" },
  { name: "ipEnabled", value: "(?:true|false)" },
  { name: "hakuranVoteApiKey", value: String.raw`(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')` },
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function constTemplateLiteralPattern(name) {
  return new RegExp(String.raw`const\s+${escapeRegExp(name)}\s*=\s*\`[\s\S]*?\`;?`);
}

function constSimplePattern(name, valuePattern) {
  return new RegExp(String.raw`const\s+${escapeRegExp(name)}\s*=\s*${valuePattern};?`);
}

function replaceConst(content, pattern, replacement) {
  if (!replacement || !pattern.test(content)) {
    return content;
  }

  return content.replace(pattern, () => replacement);
}

export function mergeRadioCustomJsTemplate(templateContent, existingContent) {
  let content = templateContent;
  const preserved = [];

  for (const name of templateLiteralNames) {
    const pattern = constTemplateLiteralPattern(name);
    const replacement = existingContent.match(pattern)?.[0] ?? "";
    const nextContent = replaceConst(content, pattern, replacement);
    if (nextContent !== content) {
      preserved.push(name);
      content = nextContent;
    }
  }

  for (const { name, value } of simpleConstPatterns) {
    const pattern = constSimplePattern(name, value);
    const replacement = existingContent.match(pattern)?.[0] ?? "";
    const nextContent = replaceConst(content, pattern, replacement);
    if (nextContent !== content) {
      preserved.push(name);
      content = nextContent;
    }
  }

  return { content, preserved };
}

export function main(argv = process.argv.slice(2)) {
  const [templatePath, existingPath, outputPath] = argv;
  if (!templatePath || !existingPath || !outputPath) {
    throw new Error("Usage: node scripts/merge-radio-custom-js.mjs TEMPLATE EXISTING OUTPUT");
  }

  const templateContent = readFileSync(templatePath, "utf8");
  const existingContent = readFileSync(existingPath, "utf8");
  const { content, preserved } = mergeRadioCustomJsTemplate(templateContent, existingContent);
  writeFileSync(outputPath, content);
  process.stdout.write(`${preserved.join(",")}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
