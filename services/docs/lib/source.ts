import { docs } from 'collections/server';
import { loader } from 'fumadocs-core/source';

export const source = loader({
  // Next.js applies the /docs base path to Fumadocs links at render time.
  baseUrl: '/',
  source: docs.toFumadocsSource(),
});
