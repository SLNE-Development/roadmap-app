import { describe, expect, it } from "vitest";
import { composeReleaseNotes } from "./release-notes";

describe("composeReleaseNotes", () => {
  it("writes shipped systems, decisions and what did not ship", () => {
    const body = composeReleaseNotes({
      name: "1.0",
      shippedOn: "2026-10-24",
      shipped: [
        { title: "Search", summary: "Find anything in one box.", lastUpdate: null },
        { title: "Billing exports", summary: "CSV and PDF invoices.", lastUpdate: "ignored" },
      ],
      decisions: [{ number: 4, title: "Use SSE for live boards" }],
      notShipped: [{ title: "Mobile app" }],
    });
    expect(body).toBe(
      [
        "# 1.0",
        "",
        "Shipped 24 Oct 2026.",
        "",
        "## Shipped",
        "",
        "- **Search**: Find anything in one box.",
        "- **Billing exports**: CSV and PDF invoices.",
        "",
        "## Decisions",
        "",
        "- ADR-0004 Use SSE for live boards",
        "",
        "## Not shipped",
        "",
        "- Mobile app",
      ].join("\n"),
    );
  });

  it("leaves out empty sections and falls back to the last update, then the title", () => {
    const body = composeReleaseNotes({
      name: "2.0",
      shippedOn: "2026-01-05",
      shipped: [
        { title: "A", summary: "", lastUpdate: "Did the thing\nmore detail" },
        { title: "B_*x*", summary: "  ", lastUpdate: null },
      ],
      decisions: [],
      notShipped: [],
    });
    expect(body).toBe("# 2.0\n\nShipped 5 Jan 2026.\n\n## Shipped\n\n- **A**: Did the thing\n- **B_*x***");
  });
});
