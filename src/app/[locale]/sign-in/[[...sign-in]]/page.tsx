import { SignIn } from "@clerk/nextjs";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { localizedPath, routes } from "@/config/routes";

type SignInPageProps = {
  params: Promise<{ locale: string }>;
};

/**
 * Route attrape-tout : Clerk gère lui-même ses sous-étapes (vérification,
 * facteur supplémentaire…) sous ce même chemin.
 */
export default async function SignInPage({ params }: SignInPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("auth");

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-16">
      <h1 className="font-heading text-2xl font-semibold">
        {t("signInHeading")}
      </h1>
      <SignIn routing="path" path={localizedPath(locale, routes.signIn)} />
    </main>
  );
}
