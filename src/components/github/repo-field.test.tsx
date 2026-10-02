// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeTRPC, handlers, resetTRPC } from "@/test/trpc-mock";
import en from "../../../messages/en";

vi.mock("@/trpc/client", () => ({ useTRPC: () => fakeTRPC() }));

const { RepoField } = await import("./repo-field");

afterEach(cleanup);

const PLACEHOLDER = "https://github.com/org/repo";

/** A repository as the picker lists it. */
const repo = (fullName: string, linked: unknown = null) => ({
  fullName,
  ownerLogin: fullName.split("/")[0],
  private: false,
  installationId: 1,
  githubRepoId: 1,
  linked,
});

beforeEach(() => {
  resetTRPC();
  // cmdk and Radix need these in jsdom.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
});

/** Renders the field and returns its `onChange` spy. */
function setup() {
  const onChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <RepoField id="repo" value="" onChange={onChange} placeholder={PLACEHOLDER} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return onChange;
}

describe("RepoField", () => {
  it("renders a URL input when the actor cannot link", async () => {
    handlers["github.pickableRepos"] = () => ({ canLink: false, repos: [] });
    setup();
    const input = await screen.findByPlaceholderText(PLACEHOLDER);
    expect(input.tagName).toBe("INPUT");
    expect(screen.queryByRole("button", { name: "Link a repository" })).toBeNull();
  });

  it("renders a combobox and reports the picked repository", async () => {
    handlers["github.pickableRepos"] = () => ({ canLink: true, repos: [repo("org/app")] });
    const onChange = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Link a repository" }));
    fireEvent.click(await screen.findByText("org/app"));
    expect(onChange).toHaveBeenCalledWith("https://github.com/org/app", "org/app");
  });

  it("disables a repository linked elsewhere", async () => {
    handlers["github.pickableRepos"] = () => ({
      canLink: true,
      repos: [repo("org/app"), repo("org/taken", { here: false, projectName: "Q" })],
    });
    const onChange = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Link a repository" }));
    const taken = (await screen.findByText("org/taken")).closest("[cmdk-item]");
    expect(taken?.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(taken as Element);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("switches to the URL input and keeps typing", async () => {
    handlers["github.pickableRepos"] = () => ({ canLink: true, repos: [repo("org/app")] });
    const onChange = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Link a repository" }));
    fireEvent.click(await screen.findByRole("button", { name: "Enter URL by hand" }));
    fireEvent.change(await screen.findByPlaceholderText(PLACEHOLDER), { target: { value: "https://x.test/a" } });
    expect(onChange).toHaveBeenCalledWith("https://x.test/a", null);
  });
});
