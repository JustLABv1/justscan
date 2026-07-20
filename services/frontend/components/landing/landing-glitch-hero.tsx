'use client';

import LetterGlitch from '@/components/LetterGlitch';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

const FALLBACK_COLORS = ['#5c7cfa', '#94a3b8', '#cbd5e1'];

export function LandingGlitchHero() {
  const { resolvedTheme } = useTheme();
  const [colors, setColors] = useState(FALLBACK_COLORS);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const styles = getComputedStyle(document.documentElement);
      const nextColors = ['--accent', '--muted', '--foreground']
        .map((token) => styles.getPropertyValue(token).trim())
        .filter(Boolean);

      if (nextColors.length === 3) setColors(nextColors);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [resolvedTheme]);

  return (
    <LetterGlitch
      centerVignette
      className="absolute inset-0 size-full opacity-60 dark:opacity-45"
      glitchColors={colors}
      glitchSpeed={resolvedTheme === 'dark' ? 92 : 118}
      smooth
    />
  );
}
