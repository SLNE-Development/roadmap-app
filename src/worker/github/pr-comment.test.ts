import { describe, expect, it } from "vitest";
import { siteUrl } from "@/lib/site";
import { COMMENT_MARKER, isTrustedAssociation, pickUrlOf, renderPrComment, type CommentLink } from "./pr-comment";

const pickUrl = "https://roadmap.example/p/p/link-pr?repo=r1&pr=419";
const task: CommentLink = { ref: "roadmap#7", title: "Results", systemTitle: "Search index", url: "https://roadmap.example/p/p/systems/search-index#task-7", closes: true, done: false };
const system: CommentLink = { ref: "roadmap:search-index", title: "Search index", systemTitle: null, url: "https://roadmap.example/p/p/systems/search-index", closes: false, done: false };

describe("renderPrComment", () => {
  it("lists the links tasks first, with the marker and the picker footer", () => {
    const body = renderPrComment({ links: [task, system], notice: null, pickUrl, showTitles: true });
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toContain("**Linked on the roadmap**");
    expect(body.indexOf("roadmap#7")).toBeLessThan(body.indexOf("roadmap:search-index"));
    expect(body).toContain("- [Results](https://roadmap.example/p/p/systems/search-index#task-7) · `roadmap#7` · Search index · closes on merge");
    expect(body.match(/closes on merge/g)).toHaveLength(1);
    expect(body).toContain(`[pick one on the roadmap](${pickUrl})`);
  });

  it("marks done tasks", () => {
    expect(renderPrComment({ links: [{ ...task, done: true }], notice: null, pickUrl, showTitles: true })).toContain("· ✓ done");
  });

  it("says so when nothing is linked", () => {
    expect(renderPrComment({ links: [], notice: null, pickUrl, showTitles: true })).toContain("no longer linked");
  });

  it("lists only the refs when titles are hidden", () => {
    const body = renderPrComment({ links: [task, system, { ...task, ref: "roadmap#8", closes: false, done: true }], notice: null, pickUrl, showTitles: false });
    expect(body).toContain("- [`roadmap#7`](https://roadmap.example/p/p/systems/search-index#task-7) · closes on merge");
    expect(body).toContain("- [`roadmap:search-index`](https://roadmap.example/p/p/systems/search-index)\n");
    expect(body).toContain("- [`roadmap#8`](https://roadmap.example/p/p/systems/search-index#task-7) · ✓ done");
    expect(body).not.toContain("Results");
    expect(body).not.toContain("Search index");
  });

  it("omits the no-longer-linked line when a notice is set", () => {
    const body = renderPrComment({ links: [], notice: "Pick one", pickUrl, showTitles: true });
    expect(body).not.toContain("no longer linked");
    expect(body).toContain("Pick one");
  });

  it("escapes markdown and mentions in titles", () => {
    const body = renderPrComment({ links: [{ ...task, title: "Fix [x] for @alice *now*" }], notice: null, pickUrl, showTitles: true });
    expect(body).toContain("[Fix \\[x\\] for @​alice \\*now\\*](");
    expect(body).not.toContain("@alice");
  });

  it("builds the picker url", () => {
    expect(pickUrlOf("p", "r 1", 7)).toBe(new URL("/p/p/link-pr?repo=r%201&pr=7", siteUrl()).toString());
  });

  it("renders a notice", () => {
    expect(renderPrComment({ links: [task], notice: "Careful now", pickUrl, showTitles: true })).toContain("\n\nCareful now\n");
  });
});

describe("isTrustedAssociation", () => {
  it("trusts owners, members and collaborators only", () => {
    expect(["OWNER", "MEMBER", "COLLABORATOR"].every(isTrustedAssociation)).toBe(true);
    expect(["NONE", "CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "", undefined].some((a) => isTrustedAssociation(a))).toBe(false);
  });
});
