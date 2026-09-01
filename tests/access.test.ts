import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateOwnerAccess } from "../src/access/index.js";

describe("validateOwnerAccess", () => {
  it("allows the configured owner email case-insensitively", () => {
    const result = validateOwnerAccess({
      ownerEmail: "Owner@Example.com",
      requesterEmail: " owner@example.com "
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.requesterEmail, "owner@example.com");
  });

  it("denies access when owner email is missing", () => {
    const result = validateOwnerAccess({ requesterEmail: "owner@example.com", ownerEmail: "" });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.some((error) => error.code === "COST_OWNER_EMAIL_REQUIRED"));
  });

  it("denies access when requester is not the owner", () => {
    const result = validateOwnerAccess({
      ownerEmail: "owner@example.com",
      requesterEmail: "other@example.com"
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.some((error) => error.code === "OWNER_ACCESS_DENIED"));
  });
});
