import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import de from "../../../messages/de";
import en from "../../../messages/en";

// The menu content renders in a portal that does not exist on the server; these stand-ins render it inline.
vi.mock("@/components/ui/dropdown-menu", () => {
  const Box = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    DropdownMenu: Box,
    DropdownMenuContent: Box,
    DropdownMenuGroup: Box,
    DropdownMenuItem: Box,
    DropdownMenuLabel: Box,
    DropdownMenuRadioGroup: Box,
    DropdownMenuRadioItem: Box,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuSub: Box,
    DropdownMenuSubContent: Box,
    DropdownMenuSubTrigger: Box,
    DropdownMenuTrigger: Box,
  };
});
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { configured: true } }),
  useMutation: () => ({ mutate: () => {} }),
  useQueryClient: () => ({ clear: () => {} }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "system", resolvedTheme: "light", setTheme: () => {} }) }));
vi.mock("@/lib/auth/client", () => ({ authClient: { signOut: async () => {} } }));
vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({ github: { account: { queryOptions: () => ({}) } }, account: { setLocale: { mutationOptions: () => ({}) } } }),
}));

const { UserArea } = await import("./user-area");

const render = (locale: "en" | "de", isAdmin: boolean) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === "de" ? de : en} timeZone="UTC">
      <UserArea name="Ammo" isAdmin={isAdmin} />
    </NextIntlClientProvider>,
  );

describe("UserArea", () => {
  it("shows the German menu trigger, label and sign-out", () => {
    const html = render("de", false);
    expect(html).toContain("Konto");
    expect(html).toContain("Ammo");
    expect(html).toContain("Abmelden");
    expect(html).toContain('aria-label="Zwischen hellem und dunklem Design wechseln"');
    expect(html).not.toContain("Sign out");
  });

  it("shows the admin role and pages in German for admins", () => {
    const html = render("de", true);
    expect(html).toContain("Admin");
    expect(html).toContain("Konten");
  });

  it("shows English by default", () => {
    expect(render("en", false)).toContain("Sign out");
  });
});
