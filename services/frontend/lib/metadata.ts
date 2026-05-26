import type { Metadata } from 'next';

export const APP_NAME = 'JustScan';
export const DEFAULT_APP_DESCRIPTION = 'Docker Image CVE Scanner';
export const PATHNAME_HEADER_NAME = 'x-justscan-pathname';

const UPPERCASE_WORDS = new Set(['ai', 'api', 'cve', 'id', 'kb', 'oidc', 'sso', 'ui', 'url']);

function decodeSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isIdentifierSegment(value: string) {
  if (!value) return false;
  if (/^\d+$/.test(value)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)) return true;
  if (/^[0-9a-f]{16,}$/i.test(value)) return true;
  if (/^[A-Za-z0-9_-]{20,}$/.test(value)) return true;
  return false;
}

function formatWord(word: string) {
  const lower = word.toLowerCase();
  if (UPPERCASE_WORDS.has(lower)) return lower.toUpperCase();
  if (!word.length) return word;
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

function formatSegment(value: string) {
  return decodeSegment(value)
    .split(/[-_]+/)
    .filter(Boolean)
    .map(formatWord)
    .join(' ');
}

export function titleFromPathname(pathname: string) {
  if (!pathname || pathname === '/') return APP_NAME;

  const labels: string[] = [];
  const segments = pathname.split('/').filter(Boolean);

  for (const segment of segments) {
    if (isIdentifierSegment(segment)) {
      labels.push('Details');
      continue;
    }

    const label = formatSegment(segment);
    if (label) labels.push(label);
  }

  if (!labels.length) return APP_NAME;
  return `${labels.join(' / ')} | ${APP_NAME}`;
}

export function buildMetadataForPathname(pathname: string): Metadata {
  return {
    title: titleFromPathname(pathname),
    description: DEFAULT_APP_DESCRIPTION,
  };
}
