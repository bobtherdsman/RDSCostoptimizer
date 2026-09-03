import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateOwnerAccess } from "../src/access/index.js";

describe("validateOwnerAccess", () => {
  it("SRV-ACCESS-001: allows upload access before registration and login are implemented", () => {
    const result = validateOwnerAccess({
      customerName: " Example Customer "
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.customerName, "Example Customer");
  });

  it("SRV-ACCESS-002: does not require COST_OWNER_EMAIL during the pre-registration upload flow", () => {
    const result = validateOwnerAccess({ ownerEmail: "", requesterEmail: "" });

    assert.equal(result.ok, true);
  });

  it("SRV-ACCESS-003: does not use requester email until registration and login are implemented", () => {
    const result = validateOwnerAccess({
      ownerEmail: "owner@example.com",
      requesterEmail: "other@example.com"
    });

    assert.equal(result.ok, true);
  });
});
