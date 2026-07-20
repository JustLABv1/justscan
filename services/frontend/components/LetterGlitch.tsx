'use client';

import { useEffect, useRef } from 'react';

type LetterGlitchProps = {
  backgroundColor?: string;
  centerVignette?: boolean;
  characters?: string;
  className?: string;
  glitchColors?: string[];
  glitchSpeed?: number;
  outerVignette?: boolean;
  smooth?: boolean;
};

type Letter = {
  char: string;
  color: string;
};

const DEFAULT_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$&*()-_+=/[]{};:<>.,0123456789';

export default function LetterGlitch({
  backgroundColor = 'transparent',
  centerVignette = false,
  characters = DEFAULT_CHARACTERS,
  className,
  glitchColors = ['#2b4539', '#61dca3', '#61b3dc'],
  glitchSpeed = 90,
  outerVignette = true,
  smooth = true,
}: LetterGlitchProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const context = canvas?.getContext('2d');

    if (!canvas || !container || !context) return;

    const lettersAndSymbols = Array.from(characters);
    const fontSize = 16;
    const charWidth = 10;
    const charHeight = 20;
    let animationFrame: number | undefined;
    let lastGlitchTime = 0;
    let isIntersecting = true;
    let isDocumentVisible = !document.hidden;
    let prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let letters: Letter[] = [];
    let grid = { columns: 0, rows: 0 };

    const randomFrom = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];

    const drawLetters = () => {
      const { width, height } = canvas.getBoundingClientRect();
      context.clearRect(0, 0, width, height);
      context.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      context.textBaseline = 'top';

      letters.forEach((letter, index) => {
        const x = (index % grid.columns) * charWidth;
        const y = Math.floor(index / grid.columns) * charHeight;
        context.fillStyle = letter.color;
        context.fillText(letter.char, x, y);
      });
    };

    const initializeLetters = (width: number, height: number) => {
      grid = {
        columns: Math.ceil(width / charWidth),
        rows: Math.ceil(height / charHeight),
      };
      letters = Array.from({ length: grid.columns * grid.rows }, () => ({
        char: randomFrom(lettersAndSymbols),
        color: randomFrom(glitchColors),
      }));
    };

    const resizeCanvas = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      initializeLetters(rect.width, rect.height);
      drawLetters();
    };

    const updateLetters = () => {
      const updateCount = Math.max(1, Math.floor(letters.length * (smooth ? 0.025 : 0.05)));

      for (let index = 0; index < updateCount; index += 1) {
        const letter = letters[Math.floor(Math.random() * letters.length)];
        if (!letter) continue;
        letter.char = randomFrom(lettersAndSymbols);
        letter.color = randomFrom(glitchColors);
      }
    };

    const animate = (timestamp: number) => {
      if (!prefersReducedMotion && isIntersecting && isDocumentVisible) {
        if (timestamp - lastGlitchTime >= glitchSpeed) {
          updateLetters();
          drawLetters();
          lastGlitchTime = timestamp;
        }
        animationFrame = window.requestAnimationFrame(animate);
      }
    };

    const startAnimation = () => {
      if (animationFrame || prefersReducedMotion || !isIntersecting || !isDocumentVisible) return;
      animationFrame = window.requestAnimationFrame(animate);
    };

    const stopAnimation = () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      animationFrame = undefined;
    };

    const handleVisibilityChange = () => {
      isDocumentVisible = !document.hidden;
      if (isDocumentVisible) startAnimation();
      else stopAnimation();
    };

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleMotionChange = (event: MediaQueryListEvent) => {
      prefersReducedMotion = event.matches;
      if (prefersReducedMotion) stopAnimation();
      else startAnimation();
    };

    const resizeObserver = new ResizeObserver(resizeCanvas);
    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        isIntersecting = entry?.isIntersecting ?? false;
        if (isIntersecting) startAnimation();
        else stopAnimation();
      },
      { threshold: 0 }
    );

    resizeObserver.observe(container);
    intersectionObserver.observe(container);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    motionQuery.addEventListener('change', handleMotionChange);
    resizeCanvas();
    startAnimation();

    return () => {
      stopAnimation();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      motionQuery.removeEventListener('change', handleMotionChange);
    };
  }, [characters, glitchColors, glitchSpeed, smooth]);

  return (
    <div
      aria-hidden="true"
      className={className ?? 'relative size-full'}
      ref={containerRef}
      style={{ backgroundColor, overflow: 'hidden' }}
    >
      <canvas ref={canvasRef} style={{ display: 'block', height: '100%', width: '100%' }} />
      {outerVignette ? (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(circle, transparent 56%, color-mix(in oklab, var(--background) 92%, transparent) 100%)',
          }}
        />
      ) : null}
      {centerVignette ? (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(circle, color-mix(in oklab, var(--background) 88%, transparent) 0%, transparent 62%)',
          }}
        />
      ) : null}
    </div>
  );
}
