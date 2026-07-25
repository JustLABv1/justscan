import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DocsBody, DocsDescription, DocsPage, DocsTitle, ViewOptionsPopover } from 'fumadocs-ui/layouts/docs/page';
import { getMDXComponents } from '@/components/mdx';
import { source } from '@/lib/source';

type PageProps = {
  params: Promise<{ slug?: string[] }>;
};

function getPage(slug?: string[]) {
  return source.getPage(slug);
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = getPage(slug);

  if (!page) return {};

  return {
    title: page.data.title,
    description: page.data.description,
  };
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  const page = getPage(slug);

  if (!page) notFound();

  const MDX = page.data.body;
  const githubUrl = `https://github.com/JustLABv1/justscan/blob/main/services/docs/content/docs/${page.path}`;

  return (
    <DocsPage toc={page.data.toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <div className="border-b pb-4">
        <ViewOptionsPopover githubUrl={githubUrl} />
      </div>
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}
