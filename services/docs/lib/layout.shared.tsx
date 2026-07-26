import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { DocsBrand } from '@/components/docs-brand';

export function baseOptions(): BaseLayoutProps {
  return {
    githubUrl: 'https://github.com/JustLABv1/justscan',
    nav: {
      title: DocsBrand,
      url: '/',
    },
  };
}
