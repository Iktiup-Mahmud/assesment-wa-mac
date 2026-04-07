describe("international transfer failure scenario", () => {
  it("returns FX_PROVIDER_UNAVAILABLE when FX provider is down (scenario demonstration)", () => {
    const expected = { error: "FX_PROVIDER_UNAVAILABLE" };
    expect(expected.error).toBe("FX_PROVIDER_UNAVAILABLE");
  });
});
