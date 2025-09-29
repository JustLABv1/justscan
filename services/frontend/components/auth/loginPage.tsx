"use client";

import { Icon } from "@iconify/react";
import {
  Button,
  Checkbox,
  Image,
  Input,
  Link,
  Alert,
  Divider,
} from "@heroui/react";
import { useRouter } from "next/navigation";
import React, { useState } from "react";

import { setSession } from "@/lib/setSession";
import LoginAPI from "@/lib/auth/login";

export default function LoginPageComponent() {
  const router = useRouter();

  const [isLoginLoading, setIsLoginLoading] = useState(false);
  const [usernameEmail, setUsernameEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);

  const [error, setError] = useState(false);
  const [errorText, setErrorText] = useState("");

  const [isVisible, setIsVisible] = useState(false);

  const toggleVisibility = () => setIsVisible(!isVisible);

  async function onLogin() {
    setIsLoginLoading(true);
    setError(false);
    setErrorText("");

    const res = await LoginAPI(usernameEmail, password, rememberMe);

    if (!res.error) {
      await setSession(res.token, res.user, res.expires_at);
      router.push("/");
      setIsLoginLoading(false);
    } else {
      setIsLoginLoading(false);
      setError(true);
      setErrorText(res.message);
    }
  }

  return (
    <div className="relative flex size-full flex-col items-center justify-center">
      <div className="flex flex-col items-center pb-2">
        <Image
          alt="Logo"
          height={28}
          radius="none"
          shadow="none"
          src={`/images/ef_logo_512.png`}
          width={28}
        />
        <p className="text-xl font-medium">Willkommen Zurück</p>
        <p className="text-small text-default-500">
          Melden Sie sich bei Ihrem Konto an, um fortzufahren
        </p>
      </div>
      <div className="mt-2 flex w-full max-w-sm flex-col gap-4 rounded-large bg-content1 px-8 py-6 shadow-small">
        {error && (
          <Alert color="danger" description={errorText} title="Error" />
        )}
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => e.preventDefault()}
        >
          <Input
            required
            endContent={
              <Icon
                className="pointer-events-none shrink-0 text-2xl text-default-400"
                icon="hugeicons:mail-at-sign-02"
              />
            }
            label="Benutzername / Email"
            name="email"
            placeholder="Geben Sie Ihren Benutzernamen oder Ihre E-Mail ein"
            type="text"
            value={usernameEmail}
            variant="flat"
            onValueChange={setUsernameEmail}
          />
          <Input
            isRequired
            endContent={
              <button type="button" onClick={toggleVisibility}>
                {isVisible ? (
                  <Icon
                    className="pointer-events-none text-2xl text-default-400"
                    icon="solar:eye-closed-linear"
                  />
                ) : (
                  <Icon
                    className="pointer-events-none text-2xl text-default-400"
                    icon="solar:eye-bold"
                  />
                )}
              </button>
            }
            label="Passwort"
            name="password"
            placeholder="Geben Sie Ihr Passwort ein"
            type={isVisible ? "text" : "password"}
            value={password}
            variant="flat"
            onValueChange={setPassword}
          />
          <div className="flex items-center justify-between px-1 py-2">
            <Checkbox
              isSelected={rememberMe}
              name="remember"
              size="sm"
              onValueChange={setRememberMe}
            >
              Angemeldet bleiben
            </Checkbox>
            <Link className="text-default-500" href="#" size="sm">
              Passwort vergessen?
            </Link>
          </div>
          <Button
            color="primary"
            isLoading={isLoginLoading}
            type="submit"
            onPress={onLogin}
          >
            Login
          </Button>
        </form>
        <Divider className="my-2" />
        <p className="text-center text-small">
          Du benötigst ein Konto?&nbsp;
          <Link href="/auth/signup" size="sm">
            Registrieren
          </Link>
        </p>
      </div>
    </div>
  );
}
