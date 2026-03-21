const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

async function proxySwaggerDocument(request: Request, path: string[]) {
  const search = new URL(request.url).search;
  const url = `${API}/api/v1/swagger/${path.join('/')}${search}`;
  const response = await fetch(url, { headers: request.headers, redirect: 'follow' });

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxySwaggerDocument(request, path ?? []);
}