export type SiteConfig = typeof siteConfig;

export const siteConfig = {
  name: "JustWMS",
  description: "Lagerverwaltungssystem.",
  version: "0.1.0",
  navItems: [
    {
      label: "Home",
      href: "/",
    },
    {
      label: "Lager",
      href: "/lager",
    },
    {
      label: "Bestellungen",
      href: "/bestellungen",
    },
    {
      label: "Kostenstellen",
      href: "/kostenstellen",
    },
  ],
  navMenuItems: [
    {
      label: "Home",
      href: "/",
    },
    {
      label: "Lager",
      href: "/lager",
    },
    {
      label: "Bestellungen",
      href: "/bestellungen",
    },
  ],
};
