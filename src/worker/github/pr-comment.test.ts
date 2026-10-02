import { describe, expect, it } from "vitest";
import { siteUrl } from "@/lib/site";
import { COMMENT_MARKER, pickUrlOf, renderPrComment, type CommentLink } from "./pr-comment";

const pickUrl = "https://roadmap.example/p/p/link-pr?repo=r1&pr=419";
const task: CommentLink = { ref: "roadmap#7", title: "Results", systemTitle: "Search index", url: "https://roadmap.example/p/p/systems/search-index#task-7", closes: true, done: false };
const system: CommentLink = { ref: "roadmap:search-index", title: "Search index", systemTitle: null, url: "https://roadmap.example/p/p/systems/search-index", closes: false, done: false };

describe("renderPrComment", () => {
  it("lists the links tasks first, with the marker and the picker footer", () => {
    const body = renderPrComment({ links: [task, system], notice: null, pickUrl });
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toContain("**Linked on the roadmap**");
    expect(body.indexOf("roadmap#7")).toBeLessThan(body.indexOf("roadmap:search-index"));
    expect(body).toContain("- [Results](https://roadmap.example/p/p/systems/search-index#task-7) · `roadmap#7` · Search index · closes on merge");
    expect(body.match(/closes on merge/g)).toHaveLength(1);
    expect(body).toContain(`[pick one on the roadmap](${pickUrl})`);
  });

  it("marks done tasks", () => {
    expect(renderPrComment({ links: [{ ...task, done: true }], notice: null, pickUrl })).toContain("· ✓ done");
  });

  it("says so when nothing is linked", () => {
    expect(renderPrComment({ links: [], notice: null, pickUrl })).toContain("no longer linked");
  });

  it("escapes markdown and mentions in titles", () => {
    const body = renderPrComment({ links: [{ ...task, title: "Fix [x] for @alice *now*" }], notice: null, pickUrl });
    expect(body).toContain("[Fix \\[x\\] for @​alice \\*now\\*](");
    expect(body).not.toContain("@alice");
  });

  it("builds the picker url", () => {
    expect(pickUrlOf("p", "r 1", 7)).toBe(new URL("/p/p/link-pr?repo=r%201&pr=7", siteUrl()).toString());
  });

  it("renders a notice", () => {
    expect(renderPrComment({ links: [task], notice: "Careful now", pickUrl })).toContain("\n\nCareful now\n");
  });
});
