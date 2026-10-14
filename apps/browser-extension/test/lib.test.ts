import { describe, expect, it } from "vitest";
import { backoffMs, isRetryable, originToPattern, parsePairing, patternToOrigin } from "../src/lib";

const TOKEN = "a".repeat(64);

describe("pairing", () => {
  it("parses JSON and plain forms", () => {
    expect(parsePairing(`{"port":17321,"token":"${TOKEN}"}`)).toEqual({ port: 17321, token: TOKEN });
    expect(parsePairing(`17321 ${TOKEN}`)).toEqual({ port: 17321, token: TOKEN });
    expect(parsePairing(`127.0.0.1:17321 ${TOKEN}`)).toEqual({ port: 17321, token: TOKEN });
  });
  it("rejects bad input", () => {
    expect(parsePairing("")).toBeNull();
    expect(parsePairing(`{"port":80,"token":"${TOKEN}"}`)).toBeNull();
    expect(parsePairing(`{"port":17321,"token":"short"}`)).toBeNull();
    expect(parsePairing(`{"port":17321,"token":"bad token with spaces"}`)).toBeNull();
    expect(parsePairing("{not json")).toBeNull();
  });
});

describe("backoff", () => {
  it("grows exponentially and caps at 30s (±20% jitter)", () => {
    expect(backoffMs(0, 0.5)).toBe(1000);
    expect(backoffMs(1, 0.5)).toBe(2000);
    expect(backoffMs(3, 0.5)).toBe(8000);
    expect(backoffMs(10, 0.5)).toBe(30000);
    expect(backoffMs(0, 0)).toBe(800);
    expect(backoffMs(0, 1)).toBe(1200);
  });
  it("retries only transient failures", () => {
    expect(isRetryable(null)).toBe(true);
    expect(isRetryable(503)).toBe(true);
    expect(isRetryable(429)).toBe(true);
    expect(isRetryable(401)).toBe(false);
    expect(isRetryable(400)).toBe(false);
    expect(isRetryable(413)).toBe(false);
  });
});

describe("origin patterns", () => {
  it("converts origins and refuses local/unsupported", () => {
    expect(originToPattern("https://chatgpt.com")).toBe("https://chatgpt.com/*");
    expect(originToPattern("https://www.bilibili.com/video/1")).toBe("https://www.bilibili.com/*");
    expect(originToPattern("http://127.0.0.1:17321")).toBeNull();
    expect(originToPattern("file:///etc")).toBeNull();
    expect(originToPattern("nonsense")).toBeNull();
    expect(patternToOrigin("https://chatgpt.com/*")).toBe("https://chatgpt.com");
  });
});
