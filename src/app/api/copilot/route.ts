import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { getCityMetrics, getVehicleMetrics, getAccountTotals } from "@/lib/queries";
import { answerCopilotQuestion } from "@/lib/engine/copilot";
import { db } from "@/lib/db/client";
import { performanceDaily } from "@/lib/db/schema";

const DAY = 24 * 60 * 60 * 1000;

export async function POST(req: Request) {
  const { error } = await requireSession();
  if (error) return error;

  const body = await req.json();
  const question: string = body.question ?? "";
  if (!question.trim()) return NextResponse.json({ error: "question is required" }, { status: 400 });

  const [cities, vehicles, totals, perf] = await Promise.all([
    getCityMetrics(),
    getVehicleMetrics(),
    getAccountTotals(),
    db.select().from(performanceDaily),
  ]);

  const now = new Date();
  const yStart = new Date(now.getTime() - 1 * DAY);
  yStart.setHours(0, 0, 0, 0);
  const yEnd = new Date(yStart.getTime() + DAY);
  const dbStart = new Date(yStart.getTime() - DAY);

  const leadsYesterday = perf.filter((p) => p.date >= yStart && p.date < yEnd).reduce((s, p) => s + p.leads, 0);
  const leadsDayBefore = perf.filter((p) => p.date >= dbStart && p.date < yStart).reduce((s, p) => s + p.leads, 0);

  const totalDailyBudget = cities.reduce((s, c) => s + c.dailyBudget, 0);

  const response = answerCopilotQuestion(question, {
    cities,
    vehicles,
    totalDailyBudget,
    totalSpend: totals.totalSpend,
    totalLeads: totals.totalLeads,
    overallCpl: totals.cpl,
    leadsYesterday,
    leadsDayBefore,
  });

  return NextResponse.json(response);
}
