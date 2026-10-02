// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { CopyRef } = await import("./copy-ref");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Renders the chip and stubs the clipboard with `writeText`. */
function setup(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <CopyRef refText="roadmap#188" />
    </NextIntlClientProvider>,
  );
}

describe("CopyRef", () => {
  it("renders the ref", () => {
    setup(vi.fn().mockResolvedValue(undefined));
    expect(screen.getByRole("button", { name: /Copy roadmap#188/ }).textContent).toBe("roadmap#188");
  });

  it("copies the ref on click and toasts", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setup(writeText);
    fireEvent.click(screen.getByRole("button"));
    expect(writeText).toHaveBeenCalledWith("roadmap#188");
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("toasts an error when the copy fails", async () => {
    setup(vi.fn().mockRejectedValue(new Error("denied")));
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });
});
