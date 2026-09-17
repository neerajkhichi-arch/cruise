import { NextResponse } from "next/server";
import { requireEditor, requireSession } from "@/lib/api-auth";
import { GraphError } from "@/lib/meta/graph";
import { parseCityList, CITY_LIST_TEMPLATE } from "@/lib/csv/city-list";
import {
  addCitiesToAdSet,
  createCityCampaign,
  listUpdatableCampaigns,
  readSource,
  resolveCityList,
} from "@/lib/meta/city-campaigns";
import { resolveAccountId } from "@/lib/accounts";

/**
 * Bulk city lists, for non-catalogue campaigns.
 *
 * Three actions behind one route, because they are three steps of one job:
 *   GET      — the campaigns a list could be added to, and the CSV template.
 *   POST     — preview: parse the file, resolve every city, change nothing.
 *   PUT      — apply: create a new campaign, or add the cities to a running one.
 *
 * Preview is a separate call on purpose. Resolving thirty city names against
 * Meta before anything is created is the whole point of the module: a file that
 * silently becomes twenty-six cities is the failure this exists to prevent.
 */

async function adAccount(req: Request): Promise<string> {
  return resolveAccountId(req);
}

function liveReady(): { ok: boolean; reason: string } {
  if (process.env.USE_MOCK_META !== "false" || !process.env.META_ACCESS_TOKEN?.trim()) {
    return { ok: false, reason: "This reads and writes your real ad account, which needs live mode." };
  }
  return { ok: true, reason: "" };
}

const describe = (err: unknown) =>
  err instanceof GraphError ? err.describe() : err instanceof Error ? err.message : String(err);

export async function GET(req: Request) {
  const { error } = await requireSession();
  if (error) return error;

  const live = liveReady();
  if (!live.ok) {
    return NextResponse.json({ error: live.reason, campaigns: [], template: CITY_LIST_TEMPLATE }, { status: 409 });
  }

  try {
    return NextResponse.json({
      campaigns: await listUpdatableCampaigns(await adAccount(req)),
      template: CITY_LIST_TEMPLATE,
    });
  } catch (err) {
    return NextResponse.json({ error: describe(err), campaigns: [], template: CITY_LIST_TEMPLATE }, { status: 502 });
  }
}

interface PreviewBody {
  csv: string;
  /** When updating, the ad set whose existing cities are compared against. */
  adSetId?: string | null;
  existingCities?: string[];
  /** When creating, the campaign whose settings and creative are copied. */
  sourceCampaignId?: string | null;
}

export async function POST(req: Request) {
  const { error } = await requireSession();
  if (error) return error;

  const live = liveReady();
  if (!live.ok) return NextResponse.json({ error: live.reason }, { status: 409 });

  const body = (await req.json()) as PreviewBody;
  if (!body.csv?.trim()) return NextResponse.json({ error: "No file content." }, { status: 400 });

  const parsed = parseCityList(body.csv);

  try {
    const resolved = await resolveCityList(parsed.cities, body.existingCities ?? []);
    const source = body.sourceCampaignId ? await readSource(body.sourceCampaignId) : null;

    const notes = [...parsed.notes];
    if (source?.usesCatalogue) {
      notes.push(
        `${source.campaignName} is a catalogue campaign — its ad draws from a product set, which is per city. Copying it here would give every city the same city's stock. Use Replicate for catalogue campaigns.`
      );
    }

    return NextResponse.json({
      cities: resolved,
      rejected: parsed.rejected,
      notes,
      headerless: parsed.headerless,
      source,
      counts: {
        parsed: parsed.cities.length,
        rejected: parsed.rejected.length,
        resolved: resolved.filter((c) => c.geoKey && !c.alreadyTargeted).length,
        unresolved: resolved.filter((c) => !c.geoKey).length,
        alreadyTargeted: resolved.filter((c) => c.alreadyTargeted).length,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: describe(err), rejected: parsed.rejected }, { status: 502 });
  }
}

interface ApplyBody {
  mode: "UPDATE" | "CREATE";
  cities: { cityName: string; geoKey: string }[];
  /** UPDATE */
  adSetId?: string;
  /** CREATE */
  sourceCampaignId?: string;
  campaignName?: string;
  dailyBudget?: number;
  activate?: boolean;
  /** Must equal the city count, so a stray click cannot start delivery. */
  confirmation?: string;
}

export async function PUT(req: Request) {
  const { error } = await requireEditor();
  if (error) return error;

  const live = liveReady();
  if (!live.ok) return NextResponse.json({ error: live.reason }, { status: 409 });

  const body = (await req.json()) as ApplyBody;
  const cities = (body.cities ?? []).filter((c) => c.cityName && c.geoKey);
  if (cities.length === 0) {
    return NextResponse.json({ error: "No resolved city to apply." }, { status: 400 });
  }
  // The same guard the publish screen uses: type the number to confirm.
  if (body.confirmation?.trim() !== String(cities.length)) {
    return NextResponse.json(
      {
        error: `Type ${cities.length} to confirm. This writes to the real ad account.`,
      },
      { status: 428 }
    );
  }

  try {
    if (body.mode === "UPDATE") {
      if (!body.adSetId) return NextResponse.json({ error: "Pick an ad set to update." }, { status: 400 });
      const result = await addCitiesToAdSet(body.adSetId, cities);
      return NextResponse.json({
        mode: "UPDATE",
        ...result,
        notes: result.added.length
          ? [
              `Editing a running ad set's targeting restarts Meta's learning phase for it. Delivery and cost per result will be unstable for a few days while it re-learns.`,
            ]
          : [],
      });
    }

    if (!body.sourceCampaignId) {
      return NextResponse.json({ error: "Pick a campaign to copy settings from." }, { status: 400 });
    }
    const name = body.campaignName?.trim();
    if (!name) return NextResponse.json({ error: "Name the new campaign." }, { status: 400 });

    const dailyBudget = Number(body.dailyBudget) || 0;
    const cap = Number(process.env.META_MAX_DAILY_BUDGET ?? 5000);
    if (dailyBudget <= 0) return NextResponse.json({ error: "A daily budget is required." }, { status: 422 });
    if (dailyBudget > cap) {
      return NextResponse.json(
        {
          error: `₹${dailyBudget.toLocaleString("en-IN")}/day exceeds the ₹${cap.toLocaleString("en-IN")}/day safety cap.`,
        },
        { status: 422 }
      );
    }

    const source = await readSource(body.sourceCampaignId);
    if (source.usesCatalogue) {
      return NextResponse.json(
        {
          error: `${source.campaignName} is a catalogue campaign. Its ad draws from a product set tied to one city, so copying it across ${cities.length} cities would advertise the wrong stock. Use Replicate for catalogue campaigns.`,
        },
        { status: 422 }
      );
    }

    const result = await createCityCampaign(await adAccount(req), source, name, cities, {
      dailyBudget,
      activate: Boolean(body.activate),
    });
    return NextResponse.json({ mode: "CREATE", ...result });
  } catch (err) {
    return NextResponse.json({ error: describe(err) }, { status: 502 });
  }
}
