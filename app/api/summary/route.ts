import { NextRequest } from "next/server";
import { getMonthlyTotals, getCategoryBreakdown, getTrends, getTopMerchants } from "@/lib/db/summary";
import { getCurrentProgress } from "@/lib/db/goals";
import { getMonthlyIncome, getIncomeByType, getIncomeVsSpend } from "@/lib/db/income";
import { getBaseline } from "@/lib/db/baseline";
import { getCashflow } from "@/lib/db/cashflow";
import { getForecast } from "@/lib/db/forecast";
import { getInsights } from "@/lib/db/insights";
import { seedCategoryRules } from "@/lib/db/categories";

export async function GET(request: NextRequest) {
  seedCategoryRules();

  const params = request.nextUrl.searchParams;
  const type = params.get("type") || "all";
  const month = params.get("month") || undefined;

  if (type === "monthly_totals") {
    return Response.json(getMonthlyTotals());
  }

  if (type === "category_breakdown") {
    return Response.json(getCategoryBreakdown(month));
  }

  if (type === "trends") {
    return Response.json(getTrends());
  }

  if (type === "top_merchants") {
    const category = params.get("category") || undefined;
    return Response.json(getTopMerchants(10, month, category));
  }

  if (type === "goals") {
    return Response.json(getCurrentProgress());
  }

  if (type === "income") {
    return Response.json({
      monthly_income: getMonthlyIncome(),
      income_by_type: getIncomeByType(),
      income_vs_spend: getIncomeVsSpend(),
    });
  }

  if (type === "baseline") {
    const threshold = params.get("threshold") ? parseInt(params.get("threshold")!) : 300;
    return Response.json(getBaseline(threshold));
  }

  if (type === "insights") {
    return Response.json(getInsights());
  }

  if (type === "cashflow") {
    return Response.json(getCashflow(month));
  }

  if (type === "forecast") {
    return Response.json(getForecast());
  }

  return Response.json({
    monthly_totals: getMonthlyTotals(),
    category_breakdown: getCategoryBreakdown(month),
    trends: getTrends(),
    top_merchants: getTopMerchants(10, month),
    goals: getCurrentProgress(),
    income_by_type: getIncomeByType(),
    income_vs_spend: getIncomeVsSpend(),
    insights: getInsights(),
    cashflow: getCashflow(),
    forecast: getForecast(),
  });
}
