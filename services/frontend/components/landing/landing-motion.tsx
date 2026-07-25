import { Children, type CSSProperties, type ReactNode } from 'react';

export function LandingHeroIntro({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className} data-landing-motion>
      {Children.map(children, (child, index) => (
        <div
          className="landing-hero-intro-item"
          style={{ '--landing-intro-index': index } as CSSProperties}
        >
          {child}
        </div>
      ))}
    </div>
  );
}

export function LandingReveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <div
      className={`landing-reveal ${className ?? ''}`}
      data-landing-motion
      style={{ '--landing-reveal-delay': `${delay}s` } as CSSProperties}
    >
      {children}
    </div>
  );
}
