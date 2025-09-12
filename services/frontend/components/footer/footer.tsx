"use client";

import { Icon } from "@iconify/react";
import { Spacer } from "@heroui/react";
import React from "react";

import { siteConfig } from "@/config/site";

export default function Footer() {
  return (
    <footer className="sticky top-[100vh] flex w-full flex-col">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-center px-6 py-12 lg:px-8">
        <div className="flex items-center justify-center">
          {/* <Image
            alt="Logo"
            height={28}
            radius="none"
            shadow="none"
            src={`/images/ef_logo_512.png`}
            width={28}
          /> */}
          <span className="text-medium font-medium pl-1">JustWMS</span>
        </div>
        <Spacer y={2} />
        <p className="mt-1 text-center text-small text-default-400">
          &copy; 2025 JustLAB. Alle Rechte vorbehalten. Version{" "}
          {siteConfig.version}
        </p>
        <p className="mt-1 flex gap-1 text-center text-small text-default-400">
          Made with <Icon icon="hugeicons:love-korean-finger" width={18} /> in
          Germany
        </p>
      </div>
    </footer>
  );
}
