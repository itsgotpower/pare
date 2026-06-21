import { NextRequest } from "next/server";
import { getScopedRepo, unauthorized } from "@/lib/repo/scoped";

export async function GET(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();
  await repo.categories.seed();

  const params = request.nextUrl.searchParams;
  const type = params.get("type") || "all";
  const month = params.get("month") || undefined;

  if (type === "monthly_totals") {
    return Response.json(await repo.summary.monthlyTotals());
  }

  if (type === "category_breakdown") {
    return Response.json(await repo.summary.categoryBreakdown(month));
  }

  if (type === "trends") {
    return Response.json(await repo.summary.trends());
  }

  if (type === "top_merchants") {
    const category = params.get("category") || undefined;
    return Response.json(await repo.summary.topMerchants(10, month, category));
  }

  if (type === "goals") {
    return Response.json(await repo.goals.currentProgress());
  }

  if (type === "income") {
    return Response.json({
      monthly_income: await repo.income.monthly(),
      income_by_type: await repo.income.byType(),
      income_vs_spend: await repo.income.vsSpend(),
    });
  }

  if (type === "month_review") {
    return Response.json(await repo.monthReview.get(month));
  }

  if (type === "baseline") {
    const threshold = params.get("threshold") ? parseInt(params.get("threshold")!) : 300;
    return Response.json(await repo.baseline.get(threshold));
  }

  if (type === "insights") {
    return Response.json(await repo.insights.get());
  }

  if (type === "cashflow") {
    return Response.json(await repo.cashflow.get(month));
  }

  if (type === "forecast") {
    return Response.json(await repo.forecast.get());
  }

  if (type === "heatmap") {
    return Response.json(await repo.heatmap.dailySpend());
  }

  if (type === "net_worth") {
    return Response.json(await repo.netWorth.get());
  }

  if (type === "cashflow_forecast") {
    return Response.json(await repo.cashflowForecast.get());
  }

  return Response.json({
    monthly_totals: await repo.summary.monthlyTotals(),
    category_breakdown: await repo.summary.categoryBreakdown(month),
    trends: await repo.summary.trends(),
    top_merchants: await repo.summary.topMerchants(10, month),
    goals: await repo.goals.currentProgress(),
    income_by_type: await repo.income.byType(),
    income_vs_spend: await repo.income.vsSpend(),
    insights: await repo.insights.get(),
    cashflow: await repo.cashflow.get(),
    forecast: await repo.forecast.get(),
    daily_spend: await repo.heatmap.dailySpend(),
    net_worth: await repo.netWorth.get(),
    cashflow_forecast: await repo.cashflowForecast.get(),
  });
}
