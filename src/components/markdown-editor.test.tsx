// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en";
import { MarkdownEditor } from "./markdown-editor";

afterEach(cleanup);

/** A controlled editor in the intl provider; `onChange` sees every value. */
function Harness({ initial = "", onChange, maxLength }: { initial?: string; onChange?: (v: string) => void; maxLength?: number }) {
  const [value, setValue] = useState(initial);
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <MarkdownEditor
        value={value}
        aria-label="Body"
        maxLength={maxLength}
        onChange={(v) => {
          setValue(v);
          onChange?.(v);
        }}
      />
    </NextIntlClientProvider>
  );
}

describe("MarkdownEditor", () => {
  it("reports typed text", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Body" }), { target: { value: "hello" } });
    expect(onChange).toHaveBeenLastCalledWith("hello");
  });

  it("wraps the selection in bold with Ctrl+B", () => {
    const onChange = vi.fn();
    render(<Harness initial="abc" onChange={onChange} />);
    const box = screen.getByRole("textbox", { name: "Body" }) as HTMLTextAreaElement;
    box.setSelectionRange(0, 3);
    fireEvent.keyDown(box, { key: "b", ctrlKey: true });
    expect(onChange).toHaveBeenLastCalledWith("**abc**");
    expect(box.value).toBe("**abc**");
  });

  it("continues a list on Enter", () => {
    const onChange = vi.fn();
    render(<Harness initial="- a" onChange={onChange} />);
    const box = screen.getByRole("textbox", { name: "Body" }) as HTMLTextAreaElement;
    box.setSelectionRange(3, 3);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("- a\n- ");
  });

  it("shows the rendered markdown in the preview", () => {
    render(<Harness initial="# Big title" />);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByRole("heading", { name: "Big title" })).toBeTruthy();
  });

  it("shows the counter when there is a limit", () => {
    render(<Harness initial="abc" maxLength={50} />);
    expect(screen.getByText("3 / 50")).toBeTruthy();
  });
});
