import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BoardAnnouncer } from "./board-announcer";

describe("BoardAnnouncer", () => {
  it("renders a polite live region with the message", () => {
    const html = renderToStaticMarkup(<BoardAnnouncer message="Moved A to Review." />);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Moved A to Review.");
  });
});
