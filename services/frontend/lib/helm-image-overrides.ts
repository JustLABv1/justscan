import type { HelmImage } from './api';

export type EditableHelmImage = HelmImage & {
  id: string;
  edited_ref: string;
};

export function createEditableHelmImages(images: HelmImage[]): EditableHelmImage[] {
  return images.map((image, index) => ({
    ...image,
    id: `${image.source_file}:${image.source_path}:${index}`,
    edited_ref: image.full_ref,
  }));
}

export function parseHelmImageRef(ref: string): { name: string; tag: string } {
  const trimmed = ref.trim();
  if (!trimmed) {
    return { name: '', tag: '' };
  }

  const digestIndex = trimmed.lastIndexOf('@');
  if (digestIndex !== -1) {
    return {
      name: trimmed.slice(0, digestIndex),
      tag: trimmed.slice(digestIndex + 1),
    };
  }

  const lastSlash = trimmed.lastIndexOf('/');
  const lastColon = trimmed.lastIndexOf(':');
  if (lastColon > lastSlash) {
    return {
      name: trimmed.slice(0, lastColon),
      tag: trimmed.slice(lastColon + 1) || 'latest',
    };
  }

  return {
    name: trimmed,
    tag: 'latest',
  };
}

export function getHelmImageSourceLabel(image: Pick<HelmImage, 'source_file' | 'source_path'>): string {
  if (!image.source_file) {
    return image.source_path;
  }

  return `${image.source_file} › ${image.source_path}`;
}