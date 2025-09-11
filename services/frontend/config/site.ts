export type SiteConfig = typeof siteConfig;

export const siteConfig = {
  name: "JustWMS",
  description: "Lagerverwaltungssystem.",
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
