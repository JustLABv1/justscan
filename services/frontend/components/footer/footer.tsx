"use client";

import { Icon } from "@iconify/react";
import { Spacer } from "@heroui/react";
import Image from "next/image";
import React from "react";
import { useTheme } from "next-themes";

import { siteConfig } from "@/config/site";

export default function Footer() {
  const { theme } = useTheme();

  return (
    <footer className="sticky top-[100vh] flex w-full flex-col">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-center px-6 py-12 lg:px-8">
        <div className="flex items-center justify-center">
          <Image
            alt="Logo"
            height={32}
            src={`/images/justlab-${theme === "light" ? "dark" : "white"}.png`}
            width={32}
          />
          <span className="text-medium font-medium pl-1">{siteConfig.name}</span>
        </div>
        <Spacer y={2} />
        <p className="mt-1 text-center text-small text-default-400">
          &copy; 2025 JustLAB. Alle Rechte vorbehalten. Version{" "}
          {siteConfig.version}
        </p>
      </div>
    </footer>
  );
}
