"use client";

import {
  Navbar as HeroUINavbar,
  NavbarContent,
  NavbarMenu,
  NavbarMenuToggle,
  NavbarBrand,
  NavbarItem,
  NavbarMenuItem,
  Link,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  User,
  addToast,
  Avatar,
  Image,
} from "@heroui/react";
import { link as linkStyles } from "@heroui/theme";
import NextLink from "next/link";
import clsx from "clsx";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useState } from "react";
import { Icon } from "@iconify/react";

import { siteConfig } from "@/config/site";
import { Logout } from "@/lib/logout";

export const Navbar = ({ userDetails, session }: any) => {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const pathname = usePathname();
  const currentPath = pathname.split("/")?.[1];

  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const onChange = () => {
    theme === "light" ? setTheme("dark") : setTheme("light");
  };

  async function LogoutHandler() {
    await Logout();
  }

  function copyToken() {
    navigator.clipboard.writeText(session);
    addToast({
      title: "Session Token",
      description: "Session Token copied to clipboard!",
      color: "success",
      variant: "flat",
    });
  }

  return (
    <HeroUINavbar
      className="bg-content1"
      isMenuOpen={isMenuOpen}
      maxWidth="xl"
      position="sticky"
      onMenuOpenChange={setIsMenuOpen}
    >
      <NavbarContent className="basis-1/5 sm:basis-full" justify="start">
        <NavbarBrand as="li" className="gap-3 max-w-fit">
          <NextLink className="flex justify-start items-center gap-1" href="/">
            <Image
              alt="Logo"
              height={32}
              src={`/images/justlab-${theme === "light" ? "dark" : "white"}.png`}
              width={32}
            />
            <p className="font-bold text-inherit">JustWMS</p>
          </NextLink>
        </NavbarBrand>
        <ul className="hidden lg:flex gap-4 justify-start ml-2">
          {siteConfig.navItems.map((item) => (
            <NavbarItem key={item.href}>
              <NextLink
                className={clsx(
                  linkStyles({ color: "foreground" }),
                  {
                    "text-primary font-bold": "/" + currentPath === item.href,
                  },
                  {
                    "font-semibold": "/" + currentPath !== item.href,
                  },
                )}
                color="foreground"
                href={item.href}
              >
                {item.label}
              </NextLink>
            </NavbarItem>
          ))}
          {userDetails.role === "admin" && (
            <NavbarItem>
              <NextLink
                className={clsx(
                  linkStyles({ color: "foreground" }),
                  {
                    "text-primary font-bold":
                      "/" + currentPath === "/system-verwaltung",
                  },
                  {
                    "font-semibold": "/" + currentPath !== "/system-verwaltung",
                  },
                )}
                color="foreground"
                href="/system-verwaltung"
              >
                System Verwaltung
              </NextLink>
            </NavbarItem>
          )}
        </ul>
      </NavbarContent>

      <NavbarContent
        className="hidden sm:flex basis-1/5 sm:basis-full"
        justify="end"
      >
        <NavbarItem className="hidden sm:flex gap-4">
          <Dropdown placement="bottom-end">
            <DropdownTrigger>
              <User
                avatarProps={{
                  isBordered: true,
                  name: userDetails.username,
                  radius: "sm",
                  size: "sm",
                  color: "primary",
                }}
                description={userDetails.email}
                name={userDetails.username}
              />
            </DropdownTrigger>
            <DropdownMenu aria-label="Profile Actions" variant="flat">
              <DropdownItem key="profile" className="h-14 gap-2">
                <p className="text-xs text-default-500">Eingeloggt als</p>
                <p className="font-semibold">
                  {userDetails.username}
                  {userDetails.role === "admin" && (
                    <span>
                      {" "}
                      | <span className="text-danger font-bold"> Admin</span>
                    </span>
                  )}
                </p>
              </DropdownItem>
              {theme === "light" ? (
                <DropdownItem
                  key="dark_mode"
                  startContent={<Icon icon="hugeicons:moon-01" width={20} />}
                  onPress={onChange}
                >
                  Dark Mode
                </DropdownItem>
              ) : (
                <DropdownItem
                  key="white_mode"
                  startContent={<Icon icon="hugeicons:sun-01" width={20} />}
                  onPress={onChange}
                >
                  White Mode
                </DropdownItem>
              )}
              <DropdownItem
                key="token"
                showDivider
                startContent={<Icon icon="hugeicons:key-02" width={20} />}
                onPress={copyToken}
              >
                Token Kopieren
              </DropdownItem>
              <DropdownItem
                key="logout"
                color="danger"
                startContent={<Icon icon="hugeicons:logout-02" width={20} />}
                onPress={LogoutHandler}
              >
                Ausloggen
              </DropdownItem>
            </DropdownMenu>
          </Dropdown>
        </NavbarItem>
      </NavbarContent>

      <NavbarContent className="sm:hidden basis-1 pl-4" justify="end">
        <Dropdown placement="bottom-end">
          <DropdownTrigger>
            <Avatar
              isBordered
              as="button"
              className="transition-transform"
              color="primary"
              name={userDetails.username}
              size="sm"
            />
          </DropdownTrigger>
          <DropdownMenu aria-label="Profile Actions" variant="flat">
            <DropdownItem key="profile" className="h-14 gap-2">
              <p className="text-xs text-default-500">Eingeloggt als</p>
              <p className="font-semibold">
                {userDetails.username}
                {" | "}
                {userDetails.role === "admin" && (
                  <span className="text-danger font-bold">Admin</span>
                )}
              </p>
            </DropdownItem>
            {theme === "light" ? (
              <DropdownItem
                key="dark_mode"
                startContent={<Icon icon="hugeicons:moon-01" width={20} />}
                onPress={onChange}
              >
                Dark Mode
              </DropdownItem>
            ) : (
              <DropdownItem
                key="white_mode"
                startContent={<Icon icon="hugeicons:sun-01" width={20} />}
                onPress={onChange}
              >
                White Mode
              </DropdownItem>
            )}
            <DropdownItem
              key="token"
              showDivider
              startContent={<Icon icon="hugeicons:key-02" width={20} />}
              onPress={copyToken}
            >
              Token Kopieren
            </DropdownItem>
            <DropdownItem
              key="logout"
              color="danger"
              startContent={<Icon icon="hugeicons:logout-02" width={20} />}
              onPress={LogoutHandler}
            >
              Ausloggen
            </DropdownItem>
          </DropdownMenu>
        </Dropdown>
        <NavbarMenuToggle />
      </NavbarContent>

      <NavbarMenu>
        <div className="mx-4 mt-2 flex flex-col gap-2">
          {siteConfig.navMenuItems.map((item, index) => (
            <NavbarMenuItem key={`${item}-${index}`}>
              <Link
                className={clsx(
                  linkStyles({ color: "foreground" }),
                  {
                    "text-primary font-bold": "/" + currentPath === item.href,
                  },
                  {
                    "font-semibold": "/" + currentPath !== item.href,
                  },
                )}
                color="foreground"
                href={item.href}
                size="lg"
                onClick={() => {
                  setIsMenuOpen(false);
                }}
              >
                {item.label}
              </Link>
            </NavbarMenuItem>
          ))}

          {userDetails.role === "admin" && (
            <NavbarItem>
              <NextLink
                className={clsx(
                  linkStyles({ color: "foreground" }),
                  {
                    "text-primary font-bold":
                      "/" + currentPath === "/system-verwaltung",
                  },
                  {
                    "font-semibold": "/" + currentPath !== "/system-verwaltung",
                  },
                )}
                color="foreground"
                href="/system-verwaltung"
              >
                System Verwaltung
              </NextLink>
            </NavbarItem>
          )}
        </div>
      </NavbarMenu>
    </HeroUINavbar>
  );
};
