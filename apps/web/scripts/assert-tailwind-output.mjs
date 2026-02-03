import fs from 'node:fs';
import path from 'node:path';

const cssPath = path.resolve(process.cwd(), 'src', 'index.css');

if (!fs.existsSync(cssPath)) {
  console.error(`Missing CSS output: ${cssPath}`);
  process.exit(2);
}

const css = fs.readFileSync(cssPath, 'utf8');

// These selectors must exist or responsive layouts will stack.
// Keep this list aligned to the utilities used by `DealWorkspaceTopSection.tsx`
// and any critical inspector sizing in `DealAnalystTab.tsx`.
const required = [
  '.md\\:grid-cols-12',
  '.md\\:col-span-4',
  '.md\\:col-span-8',
  '.md\\:grid-cols-3',

  // DealAnalystTab inspector thumbnail sizing
  '.w-\\[240px\\]',
  '.h-\\[140px\\]',
  '.max-h-\\[180px\\]',
  '.max-h-\\[160px\\]',
];

const missing = required.filter((s) => !css.includes(s));

if (missing.length) {
  console.error('Tailwind CSS output is missing required selectors:');
  for (const m of missing) console.error(`- ${m}`);
  console.error('\nFix: regenerate apps/web/src/index.css from apps/web/src/tailwind.input.css');
  process.exit(1);
}

console.log(`OK: index.css contains ${required.length} required selectors.`);
