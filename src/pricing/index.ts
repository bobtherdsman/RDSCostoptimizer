export interface PricingQuote {
  monthlyUsd: number;
  source: "live" | "fixture" | "fallback";
  customerFacing: boolean;
}

export function getPricingQuote(): PricingQuote {
  throw new Error("getPricingQuote is not implemented yet");
}