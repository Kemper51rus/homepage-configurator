import { readFileSync, writeFileSync } from "fs";
import { pathToFileURL } from "url";

const defaultEffectPattern = /const\s+DEFAULT_EFFECT\s*=\s*"[^"]+";?/;
const enabledPattern = /const\s+backgroundEffectsEnabled\s*=\s*(true|false);?/;
const defaultEffectsFunctionPattern = /function\s+getDefaultEffects\(\)\s*\{[\s\S]*?\n\s*\}/;

function replaceLiteral(content, pattern, replacement) {
  if (!replacement || !pattern.test(content)) {
    return content;
  }

  return content.replace(pattern, () => replacement);
}

function insertEnabledConst(content, replacement) {
  if (!replacement || enabledPattern.test(content)) {
    return replaceLiteral(content, enabledPattern, replacement);
  }

  return content.replace(defaultEffectPattern, (match) => `${replacement}\n  ${match}`);
}

export function mergeParticlesCustomJsTemplate(templateContent, existingContent) {
  let content = templateContent;
  const preserved = [];

  const existingEnabled = existingContent.match(enabledPattern)?.[0] ?? "";
  const nextEnabledContent = insertEnabledConst(content, existingEnabled);
  if (nextEnabledContent !== content) {
    preserved.push("backgroundEffectsEnabled");
    content = nextEnabledContent;
  }

  const existingDefaultEffect = existingContent.match(defaultEffectPattern)?.[0] ?? "";
  const nextDefaultContent = replaceLiteral(content, defaultEffectPattern, existingDefaultEffect);
  if (nextDefaultContent !== content) {
    preserved.push("DEFAULT_EFFECT");
    content = nextDefaultContent;
  }

  const existingDefaultEffectsFunction = existingContent.match(defaultEffectsFunctionPattern)?.[0] ?? "";
  const nextDefaultEffectsContent = replaceLiteral(
    content,
    defaultEffectsFunctionPattern,
    existingDefaultEffectsFunction,
  );
  if (nextDefaultEffectsContent !== content) {
    preserved.push("getDefaultEffects");
    content = nextDefaultEffectsContent;
  }

  return { content, preserved };
}

export function main(argv = process.argv.slice(2)) {
  const [templatePath, existingPath, outputPath] = argv;
  if (!templatePath || !existingPath || !outputPath) {
    throw new Error("Usage: node scripts/merge-particles-custom-js.mjs TEMPLATE EXISTING OUTPUT");
  }

  const templateContent = readFileSync(templatePath, "utf8");
  const existingContent = readFileSync(existingPath, "utf8");
  const { content, preserved } = mergeParticlesCustomJsTemplate(templateContent, existingContent);
  writeFileSync(outputPath, content);
  process.stdout.write(`${preserved.join(",")}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
