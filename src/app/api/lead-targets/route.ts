import { NextResponse } from "next/server";
import { requireEditor, requireSession } from "@/lib/api-auth";
import { GraphError, graphPost } from "@/lib/meta/graph";
import { getCityLeadsThisMonth } from "@/lib/meta/city-leads";
import { fetchLeadTargets } from "@/lib/sheets/lead-targets";
import { dayCount, rangeFromParams, todayInAccountTz } from "@/lib/date-range";
import { resolveAccountId } from "@/lib/accounts";

/**
 * City lead targets: the sheet's numbers against Meta's.
 *
 * GET compares and reports. It never changes anything — the decision to stop a
 * city's spend stays with a person, because the count it is based on is Meta's
 * attribution rather than the CRM, and those two disagree by a margin that
 * matters when the consequence is switching a market off.
 *
 * POST pauses, and only when asked, naming a specific city.
 */

async function adAccountId(req: Request): Promise<string> {
  return resolveAccountId(req);
}

function liveReasons(): string[] {
  const reasons: string[] = [];
  if (process.env.USE_MOCK_META !== "false") reasons.push("USE_MOCK_META is not set to false");
  if (!process.env.META_ACCESS_TOKEN?.trim()) reasons.push("META_ACCESS_TOKEN is not set");
  return reasons;
}

export interface CityTargetRow {
  cityName: string;
  target: number | null;
  leads: number;
  spend: number;
  /** Rupees allowed this month, from the sheet. Null means no ceiling given. */
  budget: number | null;
  /** leads / target, or null when the sheet has no target for this city. */
  progress: number | null;
  /** spend / budget, or null when no budget was given. */
  budgetProgress: number | null;
  status: "OVER" | "CLOSE" | "UNDER" | "NO_TARGET" | "NO_DELIVERY";
  budgetStatus: "EXHAUSTED" | "CLOSE" | "WITHIN" | "NO_BUDGET";
  /**
   * Why this city wants stopping, if it does. Budget outranks leads: spend is
   * money that has already left the account, while a lead count is Meta's
   * attributed estimate and can be revised. One is a fact, the other an opinion.
   */
  stopReason: "BUDGET" | "TARGET" | null;
  /**
   * The date the budget runs out at the current rate, or null when there is no
   * budget, no spend yet, or it already has. A projection, not a promise — but
   * "exhausts on the 19th" is the difference between noticing and reacting.
   */
  projectedExhaustDate: string | null;
  campaigns: { campaignId: string; campaignName: string; status: string }[];
  attributionSettings: string[];
}

export async function GET(req: Request) {
  const { error } = await requireSession();
  if (error) return error;

  const blocked = liveReasons();
  if (blocked.length > 0) {
    return NextResponse.json(
      { error: `Lead targets read live numbers from Meta. ${blocked.join("; ")}.`, needsLive: true },
      { status: 409 }
    );
  }

  let sheet;
  try {
    sheet = await fetchLeadTargets();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), needsSheet: true },
      { status: 409 }
    );
  }

  // Defaults to this month, since targets are monthly — but any range can be
  // asked for, which is what makes a number checkable against Ads Manager.
  const range = rangeFromParams(new URL(req.url).searchParams, "this_month");

  let actuals;
  try {
    actuals = await getCityLeadsThisMonth(await adAccountId(req), { since: range.since, until: range.until });
  } catch (err) {
    const message = err instanceof GraphError ? err.describe() : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const today = todayInAccountTz();
  const targetByCity = new Map(sheet.targets.map((t) => [t.cityName.toLowerCase(), t]));
  const actualByCity = new Map(actuals.cities.map((c) => [c.cityName.toLowerCase(), c]));

  // Every city that appears in EITHER source. A city in the sheet with no
  // delivery is as much a thing worth seeing as a city delivering with no
  // target — the second is how spend escapes a target regime unnoticed.
  const keys = new Set([...targetByCity.keys(), ...actualByCity.keys()]);

  const rows: CityTargetRow[] = [...keys].map((key) => {
    const t = targetByCity.get(key);
    const a = actualByCity.get(key);
    const leads = a?.leads ?? 0;
    const target = t?.target ?? null;
    const progress = target ? leads / target : null;

    let status: CityTargetRow["status"];
    if (!target) status = "NO_TARGET";
    else if (!a) status = "NO_DELIVERY";
    else if (progress !== null && progress >= 1) status = "OVER";
    else if (progress !== null && progress >= 0.85) status = "CLOSE";
    else status = "UNDER";

    const spend = Math.round(a?.spend ?? 0);
    const budget = t?.budget ?? null;
    const budgetProgress = budget ? spend / budget : null;

    let budgetStatus: CityTargetRow["budgetStatus"];
    if (!budget) budgetStatus = "NO_BUDGET";
    else if (budgetProgress !== null && budgetProgress >= 1) budgetStatus = "EXHAUSTED";
    else if (budgetProgress !== null && budgetProgress >= 0.85) budgetStatus = "CLOSE";
    else budgetStatus = "WITHIN";

    // Run rate over the days ELAPSED in the range, projected forward. Dividing
    // by the whole range would understate the rate early in a month and put the
    // exhaust date comfortably in the future when it is not.
    let projectedExhaustDate: string | null = null;
    if (budget && spend > 0 && budgetStatus !== "EXHAUSTED") {
      const elapsed = Math.max(1, dayCount({ since: range.since, until: today, preset: range.preset }));
      const perDay = spend / elapsed;
      if (perDay > 0) {
        const daysLeft = Math.ceil((budget - spend) / perDay);
        if (daysLeft >= 0 && daysLeft < 400) {
          const [y, m, d] = today.split("-").map(Number);
          const dt = new Date(Date.UTC(y, m - 1, d + daysLeft));
          const pad = (v: number) => String(v).padStart(2, "0");
          projectedExhaustDate = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
        }
      }
    }

    return {
      cityName: t?.cityName ?? a?.cityName ?? key,
      target,
      leads,
      spend,
      budget,
      progress,
      budgetProgress,
      status,
      budgetStatus,
      stopReason:
        budgetStatus === "EXHAUSTED" ? "BUDGET" : status === "OVER" ? "TARGET" : null,
      projectedExhaustDate,
      campaigns: (a?.campaigns ?? []).map((c) => ({
        campaignId: c.campaignId,
        campaignName: c.campaignName,
        status: c.status,
      })),
      attributionSettings: a?.attributionSettings ?? [],
    };
  });

  // Budget exhausted sits above target reached: one is money already spent,
  // the other is a goal met. Only the first is still costing anything.
  const rank = (r: CityTargetRow): number => {
    if (r.budgetStatus === "EXHAUSTED") return 0;
    if (r.status === "OVER") return 1;
    if (r.budgetStatus === "CLOSE") return 2;
    if (r.status === "CLOSE") return 3;
    if (r.status === "UNDER") return 4;
    if (r.status === "NO_TARGET") return 5;
    return 6;
  };
  rows.sort(
    (x, y) =>
      rank(x) - rank(y) ||
      (y.budgetProgress ?? 0) - (x.budgetProgress ?? 0) ||
      (y.progress ?? 0) - (x.progress ?? 0)
  );

  return NextResponse.json({
    period: { since: actuals.since, until: actuals.until },
    range,
    rows,
    sheet: { fetchedAt: sheet.fetchedAt, problems: sheet.problems, cityCount: sheet.targets.length },
    actionType: actuals.actionType,
    notes: actuals.notes,
  });
}

interface PauseBody {
  cityName: string;
  campaignIds: string[];
}

export async function POST(req: Request) {
  const { error } = await requireEditor();
  if (error) return error;

  if (liveReasons().length > 0) {
    return NextResponse.json({ error: "Not in live mode, so nothing can be paused." }, { status: 409 });
  }

  const body = (await req.json()) as PauseBody;
  const ids = (body.campaignIds ?? []).filter((id) => /^\d+$/.test(id));
  if (ids.length === 0) {
    return NextResponse.json({ error: "No campaign was named to pause." }, { status: 400 });
  }

  // Each campaign is paused on its own and reported on its own. A partial
  // result is the truth when one of three calls fails, and pretending
  // otherwise leaves a city half-stopped with nobody aware of it.
  const paused: string[] = [];
  const failed: { campaignId: string; error: string }[] = [];

  for (const campaignId of ids) {
    try {
      await graphPost(campaignId, { status: "PAUSED" });
      paused.push(campaignId);
    } catch (err) {
      failed.push({
        campaignId,
        error: err instanceof GraphError ? err.describe() : err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    cityName: body.cityName,
    paused,
    failed,
    ok: failed.length === 0,
  });
}
