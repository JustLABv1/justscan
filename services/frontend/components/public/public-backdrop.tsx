/**
 * Decorative glow and dot grid behind a public page's hero. Uses theme tokens,
 * so it follows light and dark mode. Place it first inside a `relative` page.
 */
export function PublicBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[38rem] overflow-hidden"
    >
      <div className="absolute left-1/2 top-[-14rem] size-[44rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--info)_30%,transparent),transparent)] blur-2xl" />
      <div className="absolute left-[4%] top-8 size-[24rem] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--success)_16%,transparent),transparent)] blur-3xl" />
      <div className="absolute right-[2%] top-20 size-[22rem] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--warning)_12%,transparent),transparent)] blur-3xl" />
      <div className="absolute inset-0 [background-image:radial-gradient(color-mix(in_oklab,var(--foreground)_16%,transparent)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]" />
    </div>
  );
}
