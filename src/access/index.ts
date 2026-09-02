import type { ApiValidationError } from "../api/index.js";

export interface OwnerAccessInput {
  requesterEmail?: string | null;
  ownerEmail?: string | null;
  customerName?: string | null;
}

export interface OwnerAccessGranted {
  ok: true;
  customerName?: string;
}

export interface OwnerAccessDenied {
  ok: false;
  errors: ApiValidationError[];
}

export type OwnerAccessResult = OwnerAccessGranted | OwnerAccessDenied;

export function validateOwnerAccess(input: OwnerAccessInput): OwnerAccessResult {
  const customerName = input.customerName?.trim();
  return customerName ? { ok: true, customerName } : { ok: true };
}
