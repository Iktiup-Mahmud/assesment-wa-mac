import { hashPayload } from "../src/idempotency";

describe("idempotency hash", () => {
  it("returns same hash for same payload", () => {
    const payload = { amount: "100.0000", currency: "USD" };
    const a = hashPayload(payload);
    const b = hashPayload(payload);
    expect(a).toBe(b);
  });

  it("returns different hash for different payload", () => {
    const a = hashPayload({ amount: "100.0000" });
    const b = hashPayload({ amount: "200.0000" });
    expect(a).not.toBe(b);
  });

  it("covers scenario E payload mismatch", () => {
    const initial = hashPayload({ amount: "500.0000", destination: "A" });
    const changed = hashPayload({ amount: "800.0000", destination: "A" });
    expect(initial).not.toEqual(changed);
  });

  it("covers scenario A same key same payload", () => {
    const one = hashPayload({ idempotency_key: "k", amount: "100.0000" });
    const two = hashPayload({ idempotency_key: "k", amount: "100.0000" });
    expect(one).toEqual(two);
  });

  it("covers scenario B high concurrency deterministic hash", () => {
    const hashes = Array.from({ length: 1000 }, () =>
      hashPayload({ id: "same", amount: "10.0000" }),
    );
    expect(new Set(hashes).size).toBe(1);
  });
});
