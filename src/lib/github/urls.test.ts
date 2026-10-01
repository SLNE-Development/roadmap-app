import { describe, expect, it } from "vitest";
import { isPublicOrigin } from "./urls";

describe("isPublicOrigin", () => {
  it.each([
    "http://localhost:3001",
    "http://app.localhost",
    "http://127.0.0.1:3000",
    "http://127.5.6.7",
    "http://[::1]:3000",
    "http://0.0.0.0",
    "http://10.1.2.3",
    "http://172.16.0.1",
    "http://172.31.255.255",
    "http://192.168.1.20",
    "http://169.254.10.10",
    "http://nas.local",
  ])("treats %s as not reachable", (url) => {
    expect(isPublicOrigin(new URL(url))).toBe(false);
  });

  it.each([
    "https://roadmap.example.com",
    "https://roadmap.example.com:8443",
    "http://8.8.8.8",
    "http://172.15.0.1",
    "http://172.32.0.1",
    "http://192.169.0.1",
    "https://localhost.example.com",
    "https://notlocal.com",
  ])("treats %s as public", (url) => {
    expect(isPublicOrigin(new URL(url))).toBe(true);
  });
});
