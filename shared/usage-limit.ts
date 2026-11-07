export const usageLimitReached = (value: unknown) =>
  /usage.?limit|usage_limit_reached|rate.?limit.?exceeded|insufficient_quota|you(?:'|’)ve hit your .*limit/i.test(String(value || ""));

export const usageLimitMessage = "You've hit your usage limit. Upgrade your plan or add credits to continue, or try again later.";
