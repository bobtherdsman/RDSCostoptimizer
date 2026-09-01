import type { ApiValidationError } from "../api/index.js";

export interface OwnerAccessInput {
  requesterEmail?: string | null;
  ownerEmail?: string | null;
}

export interface OwnerAccessGranted {
  ok: true;
  requesterEmail: string;
}

export interface OwnerAccessDenied {
  ok: false;
  errors: ApiValidationError[];
}

export type OwnerAccessResult = OwnerAccessGranted | OwnerAccessDenied;

export function validateOwnerAccess(input: OwnerAccessInput): OwnerAccessResult {
  const ownerEmail = normalizeEmail(input.ownerEmail ?? process.env.COST_OWNER_EMAIL);
  const requesterEmail = normalizeEmail(input.requesterEmail);
  const errors: ApiValidationError[] = [];

  if (!ownerEmail) {
    errors.push({
      code: "COST_OWNER_EMAIL_REQUIRED",
      field: "COST_OWNER_EMAIL",
      message: "Owner-only access requires COST_OWNER_EMAIL to be configured."
    });
  }

  if (!requesterEmail) {
    errors.push({
      code: "REQUESTER_EMAIL_REQUIRED",
      field: "requesterEmail",
      message: "Owner-only access requires a requester email."
    });
  }

  if (ownerEmail && requesterEmail && ownerEmail !== requesterEmail) {
    errors.push({
      code: "OWNER_ACCESS_DENIED",
      field: "requesterEmail",
      message: "Requester is not allowed to use the RDS Cost Optimization manual upload flow."
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, requesterEmail };
}

function normalizeEmail(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}
