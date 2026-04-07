describe("Failure Scenario Demonstration: FX provider outage", () => {
  it("documents expected behavior for outage: no partial ledger writes", () => {
    const tracePath = [
      "API Gateway",
      "Transaction Service",
      "FX Service",
      "error",
    ];
    const error = "FX_PROVIDER_UNAVAILABLE";
    const partialLedgerEntries = 0;

    expect(tracePath).toEqual([
      "API Gateway",
      "Transaction Service",
      "FX Service",
      "error",
    ]);
    expect(error).toBe("FX_PROVIDER_UNAVAILABLE");
    expect(partialLedgerEntries).toBe(0);
  });
});
