// Campaign Naming Automation (spec section 11).
// Default template: UC | META | LEAD | AHMEDABAD | CATALOGUE | {AUDIENCE}
// Admins can redefine the template in Settings > Naming Conventions.

const OBJECTIVE_LABEL: Record<string, string> = {
  LEADS: "LEAD",
  WHATSAPP_LEADS: "WHATSAPP",
  WEBSITE_LEADS: "WEBSITE",
};

export function generateCampaignName(
  template: string,
  input: { objective: string; cityLabel: string; audience: string }
): string {
  return template
    .replace("{OBJECTIVE}", OBJECTIVE_LABEL[input.objective] ?? input.objective)
    .replace("{CITY}", input.cityLabel.toUpperCase())
    .replace("{AUDIENCE}", input.audience.toUpperCase());
}

export const DEFAULT_NAMING_TEMPLATE = "UC | META | {OBJECTIVE} | {CITY} | CATALOGUE | {AUDIENCE}";
