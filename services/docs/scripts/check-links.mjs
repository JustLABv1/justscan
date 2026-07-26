import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const contentRoot = path.resolve('content/docs');

async function getMdxFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return getMdxFiles(filePath);
      return entry.isFile() && entry.name.endsWith('.mdx') ? [filePath] : [];
    }),
  );

  return nested.flat();
}

function routeFor(filePath) {
  const relative = path.relative(contentRoot, filePath).replace(/\.mdx$/, '');
  return relative === 'index' ? '/' : `/${relative}`;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function headingsFor(content) {
  return new Set(
    [...content.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => slugify(match[1])),
  );
}

const files = await getMdxFiles(contentRoot);
const pages = new Map();

for (const filePath of files) {
  const content = await readFile(filePath, 'utf8');
  pages.set(routeFor(filePath), { filePath, headings: headingsFor(content) });
}

const failures = [];
for (const filePath of files) {
  const content = await readFile(filePath, 'utf8');
  for (const match of content.matchAll(/\]\((\/[^)\s]+)\)/g)) {
    const target = match[1];
    if (target.startsWith('/swagger/') || target.startsWith('/api/')) continue;

    const [route, fragment] = target.split('#');
    const page = pages.get(route || '/');
    if (!page) {
      failures.push(`${path.relative(process.cwd(), filePath)} links to missing route ${target}`);
      continue;
    }
    if (fragment && !page.headings.has(slugify(decodeURIComponent(fragment)))) {
      failures.push(`${path.relative(process.cwd(), filePath)} links to missing heading ${target}`);
    }
  }
}

if (failures.length > 0) {
  console.error('Documentation link validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${pages.size} documentation routes and internal MDX links.`);
}
