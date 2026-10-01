import type { LOCALES } from "./locale";

declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof LOCALES)[number];
    Messages: typeof import("../../messages/en").default;
  }
}
