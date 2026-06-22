import fs from 'fs';
import path from 'path';

const root = process.cwd();

const radioJs = fs.readFileSync(path.join(root, 'custom-config/radio/custom.js'), 'utf8');
const radioCss = fs.readFileSync(path.join(root, 'custom-config/radio/custom.css'), 'utf8');
const particlesJs = fs.readFileSync(path.join(root, 'custom-config/particles/custom.js'), 'utf8');
const particlesCss = fs.readFileSync(path.join(root, 'custom-config/particles/custom.css'), 'utf8');

const outputContent = `// Automatically generated templates. Do not edit manually.
export const radioJsTemplate = ${JSON.stringify(radioJs)};
export const radioCssTemplate = ${JSON.stringify(radioCss)};
export const particlesJsTemplate = ${JSON.stringify(particlesJs)};
export const particlesCssTemplate = ${JSON.stringify(particlesCss)};
`;

const targetDir = path.join(root, 'overlay/src/mods/browser-editor/lib');
fs.mkdirSync(targetDir, { recursive: true });
fs.writeFileSync(path.join(targetDir, 'templates.js'), outputContent);
console.log('templates.js successfully generated.');
