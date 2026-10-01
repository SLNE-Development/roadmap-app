import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BoardAnnouncer, moveMessage, refusedMessage } from "./board-announcer";

describe("BoardAnnouncer", () => {
  it("renders a polite live region with the message", () => {
    const html = renderToStaticMarkup(<BoardAnnouncer message="Moved A to Review." />);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Moved A to Review.");
  });

  it("words moves and refusals", () => {
    expect(moveMessage("A", "Review")).toBe("Moved A to Review.");
    expect(refusedMessage("A", "Planning is incomplete.")).toBe("A stayed put: Planning is incomplete.");
  });
});
