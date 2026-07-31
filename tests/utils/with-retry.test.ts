import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../../src/utils/with-retry.js";

describe("withRetry", () => {
  it("returns result on first attempt if successful", async () => {
    const fn = vi.fn().mockResolvedValue("success");
    const res = await withRetry(fn);
    expect(res).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries up to attempts count on failure and succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("success");

    const res = await withRetry(fn, { attempts: 3, baseDelayMs: 1 });
    expect(res).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws last error if all attempts fail", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("persistent failure"));

    await expect(
      withRetry(fn, { attempts: 3, baseDelayMs: 1 })
    ).rejects.toThrow("persistent failure");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("respects shouldRetry callback", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("non-retryable"));
    const shouldRetry = vi.fn().mockReturnValue(false);

    await expect(
      withRetry(fn, { attempts: 3, baseDelayMs: 1, shouldRetry })
    ).rejects.toThrow("non-retryable");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledTimes(1);
  });
});
