import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, DollarSign, MousePointerClick, ShoppingCart } from "lucide-react";
import type { ProductInsightData } from "../types";

interface SummaryMetricsProps {
  data: ProductInsightData[];
}

export function SummaryMetrics({ data }: SummaryMetricsProps) {
  if (!data || data.length === 0) {
    return null;
  }

  // Calculate aggregate metrics
  const totalProducts = data.length;
  const totalSpend = data.reduce((sum, item) => sum + (item.spend || 0), 0);
  const totalImpressions = data.reduce((sum, item) => sum + (item.impressions || 0), 0);
  const totalClicks = data.reduce((sum, item) => sum + (item.link_clicks || 0), 0);
  const totalPurchases = data.reduce((sum, item) => sum + (item.purchases || 0), 0);
  const totalAddsToCart = data.reduce((sum, item) => sum + (item.adds_to_cart || 0), 0);

  // Calculate averages
  const avgCTR = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
  const conversionRate = totalClicks > 0 ? (totalPurchases / totalClicks) * 100 : 0;

  const metrics = [
    {
      label: "Total Products",
      value: totalProducts.toLocaleString(),
      icon: TrendingUp,
      color: "text-blue-600",
      bgColor: "bg-blue-50",
    },
    {
      label: "Total Spend",
      value: `$${totalSpend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      icon: DollarSign,
      color: "text-green-600",
      bgColor: "bg-green-50",
    },
    {
      label: "Avg CTR",
      value: `${avgCTR.toFixed(2)}%`,
      icon: MousePointerClick,
      color: "text-purple-600",
      bgColor: "bg-purple-50",
    },
    {
      label: "Conversion Rate",
      value: `${conversionRate.toFixed(2)}%`,
      icon: ShoppingCart,
      color: "text-orange-600",
      bgColor: "bg-orange-50",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      {metrics.map((metric, index) => {
        const Icon = metric.icon;
        return (
          <Card key={index} className="border-0 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold uppercase text-muted-foreground tracking-wider mb-2">
                    {metric.label}
                  </p>
                  <p className="text-2xl font-bold">{metric.value}</p>
                </div>
                <div className={`${metric.bgColor} p-3 rounded`}>
                  <Icon className={`w-6 h-6 ${metric.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
