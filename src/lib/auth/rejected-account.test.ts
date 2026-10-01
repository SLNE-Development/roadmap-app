import { describe, expect, it, vi } from "vitest";
import { clearRejectedAccount, REJECTED_ID_COOKIE, rejectedAccountId, rememberRejectedAccount } from "./rejected-account";

describe("rejectedAccountId", () => {
  it("returns the id for a not-on-the-allowlist error", () => {
    expect(rejectedAccountId("not_provisioned", "123456789012345678")).toBe("123456789012345678");
    expect(rejectedAccountId("NOT_PROVISIONED", "123456789012345678")).toBe("123456789012345678");
  });

  it("returns null without the cookie, without an error or for another error", () => {
    expect(rejectedAccountId("not_provisioned", undefined)).toBeNull();
    expect(rejectedAccountId(undefined, "123456789012345678")).toBeNull();
    expect(rejectedAccountId("access_denied", "123456789012345678")).toBeNull();
    expect(rejectedAccountId("unable_to_create_session", "123456789012345678")).toBeNull();
  });

  it("returns null for a cookie that is not a Discord id", () => {
    expect(rejectedAccountId("not_provisioned", "<script>")).toBeNull();
    expect(rejectedAccountId("not_provisioned", "12")).toBeNull();
    expect(rejectedAccountId("not_provisioned", "1".repeat(40))).toBeNull();
  });
});

describe("rememberRejectedAccount", () => {
  it("sets a short-lived httpOnly cookie scoped to the login page", () => {
    const setCookie = vi.fn();
    rememberRejectedAccount({ setCookie }, "123456789012345678", true);
    expect(setCookie).toHaveBeenCalledWith(REJECTED_ID_COOKIE, "123456789012345678", expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/login", maxAge: 600, secure: true }));
  });

  it("expires the cookie when the refusal has no id, so an earlier id never lingers", () => {
    const setCookie = vi.fn();
    rememberRejectedAccount({ setCookie }, null, false);
    expect(setCookie).toHaveBeenCalledWith(REJECTED_ID_COOKIE, "", expect.objectContaining({ maxAge: 0, path: "/login" }));
  });

  it("clears the cookie after a successful sign-in", () => {
    const setCookie = vi.fn();
    clearRejectedAccount({ setCookie }, false);
    expect(setCookie).toHaveBeenCalledWith(REJECTED_ID_COOKIE, "", expect.objectContaining({ maxAge: 0 }));
  });

  it("does nothing outside a request", () => {
    expect(() => rememberRejectedAccount(null, "123456789012345678", false)).not.toThrow();
  });
});
