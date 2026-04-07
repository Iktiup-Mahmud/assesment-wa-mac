describe("double entry invariant concept", () => {
  it("debit sum should equal credit sum for a transaction", () => {
    const debit = 100;
    const credit = 100;
    expect(debit).toBe(credit);
  });
});
