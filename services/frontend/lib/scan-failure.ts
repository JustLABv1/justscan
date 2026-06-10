export type ScanFailurePresentation = {
  title: string;
  description: string;
  guidance: string;
};

export function getScanFailurePresentation(
  errorMessage = '',
  imageReference?: string
): ScanFailurePresentation {
  const normalizedMessage = errorMessage.toLowerCase();
  const image = imageReference?.trim() || 'the requested image';

  if (
    normalizedMessage.includes('manifest_unknown') ||
    normalizedMessage.includes('manifest unknown') ||
    normalizedMessage.includes('unknown tag=') ||
    normalizedMessage.includes('name_unknown')
  ) {
    return {
      title: 'Image not found',
      description: `The registry could not find ${image}.`,
      guidance:
        'Check that the image name and tag are correct. If the image is private, also verify that the registry credentials can access it.',
    };
  }

  if (
    normalizedMessage.includes('unauthorized:') ||
    normalizedMessage.includes('authentication required') ||
    normalizedMessage.includes('denied: requested access') ||
    normalizedMessage.includes('insufficient_scope')
  ) {
    return {
      title: 'Registry access denied',
      description: `The scanner could not access ${image}.`,
      guidance:
        'Verify that the registry credentials are valid and have permission to pull this image.',
    };
  }

  return {
    title: 'Scan could not be completed',
    description: `The scanner encountered a problem while scanning ${image}.`,
    guidance:
      'Try the scan again. If it continues to fail, open the technical details below to troubleshoot the scanner or registry connection.',
  };
}
