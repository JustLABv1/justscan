'use client';

import { motion, useReducedMotion, type Variants } from 'motion/react';
import { Children, type ReactNode } from 'react';

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export function LandingHeroIntro({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const itemVariants: Variants = {
    hidden: {
      opacity: 0,
      transform: reduceMotion ? 'none' : 'translateY(12px)',
    },
    visible: {
      opacity: 1,
      transform: 'translateY(0px)',
      transition: {
        duration: reduceMotion ? 0.18 : 0.44,
        ease: EASE_OUT,
      },
    },
  };

  return (
    <motion.div
      animate="visible"
      className={className}
      data-landing-motion
      initial="hidden"
      variants={{
        hidden: {},
        visible: {
          transition: {
            staggerChildren: reduceMotion ? 0 : 0.05,
          },
        },
      }}
    >
      {Children.map(children, (child) => (
        <motion.div variants={itemVariants}>{child}</motion.div>
      ))}
    </motion.div>
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
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      data-landing-motion
      initial={{
        opacity: 0,
        transform: reduceMotion ? 'none' : 'translateY(12px)',
      }}
      transition={{
        delay: reduceMotion ? 0 : delay,
        duration: reduceMotion ? 0.18 : 0.42,
        ease: EASE_OUT,
      }}
      viewport={{ amount: 0.16, margin: '-64px', once: true }}
      whileInView={{ opacity: 1, transform: 'translateY(0px)' }}
    >
      {children}
    </motion.div>
  );
}
