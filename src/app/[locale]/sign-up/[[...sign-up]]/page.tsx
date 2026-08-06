import { SignUp } from "@clerk/nextjs";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { localizedPath, routes } from "@/config/routes";

type SignUpPageProps = {
  params: Promise<{ locale: string }>;
};

export default async function SignUpPage({ params }: SignUpPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("auth");

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-16">
      <h1 className="font-heading text-2xl font-semibold">
        {t("signUpHeading")}
      </h1>
      <SignUp routing="path" path={localizedPath(locale, routes.signUp)} />
    </main>
  );
}
