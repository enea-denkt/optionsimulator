
import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, DollarSign, Activity } from "lucide-react";


function payoffAtExpiration(spot, strike, optionType = 'call') {
  return optionType === 'call'
    ? Math.max(spot - strike, 0)
    : Math.max(strike - spot, 0);
}


export default function MetricsSummary({ data, initialValue, premiumPaid, filters }) {
  const { currentPrice, strikePrice, currentIV, expectedIVChange, expectedPriceChange, riskFreeRate, optionType, daysToExpiration, entryPremium } = filters;
  
  // Calculate expected values
  const expectedStockPrice = currentPrice * (1 + expectedPriceChange / 100);
  const expectedIV = currentIV + (currentIV * expectedIVChange / 100);
  
  const expectedPremium = payoffAtExpiration(
    expectedStockPrice,
    strikePrice,
    optionType
  );
  
  
  // Use Entry Premium if provided, otherwise use current premium
  const baselineForReturn = entryPremium !== null && entryPremium !== undefined ? entryPremium : premiumPaid;
  const premiumChange = premiumPaid > 0 ? ((expectedPremium - premiumPaid) / premiumPaid * 100) : 0;
  const netReturn = baselineForReturn > 0 ? ((expectedPremium - baselineForReturn) / baselineForReturn * 100) : 0;
  
  // Determine subtitle for net return
  const netReturnSubtitle = entryPremium !== null && entryPremium !== undefined 
    ? `From Entry Premium of $${entryPremium.toFixed(2)}`
    : "From Current Premium";

   

  const metrics = [
    {
      title: "Expected Stock Price",
      value: `$${expectedStockPrice.toFixed(2)}`,
      change: `${expectedPriceChange >= 0 ? '+' : ''}${expectedPriceChange.toFixed(1)}%`,
      subtitle: `Current: $${currentPrice.toFixed(2)}`,
      icon: Activity,
      color: expectedPriceChange >= 0 ? "text-emerald-600" : "text-rose-600",
      bgColor: expectedPriceChange >= 0 ? "bg-emerald-100" : "bg-rose-100"
    },
    {
      title: "Expected Implied Volatility", // Updated label
      value: `${expectedIV.toFixed(1)}%`,
      change: `${expectedIVChange >= 0 ? '+' : ''}${expectedIVChange.toFixed(1)}%`,
      subtitle: `Current IV: ${currentIV.toFixed(1)}%`,
      icon: TrendingUp,
      color: expectedIVChange >= 0 ? "text-emerald-600" : "text-rose-600",
      bgColor: expectedIVChange >= 0 ? "bg-emerald-100" : "bg-rose-100"
    },
    {
      title: "Expected Premium",
      value: `$${expectedPremium.toFixed(2)}`,
      change: `${premiumChange >= 0 ? '+' : ''}${premiumChange.toFixed(1)}%`,
      subtitle: `Current: $${premiumPaid.toFixed(2)}`,
      icon: DollarSign,
      color: premiumChange >= 0 ? "text-emerald-600" : "text-rose-600",
      bgColor: premiumChange >= 0 ? "bg-emerald-100" : "bg-rose-100"
    },
    {
      title: "Expected Net Return", // Updated label
      value: `${netReturn >= 0 ? '+' : ''}${netReturn.toFixed(2)}%`,
      icon: netReturn >= 0 ? TrendingUp : TrendingDown,
      color: netReturn >= 0 ? "text-emerald-600" : "text-rose-600",
      bgColor: netReturn >= 0 ? "bg-emerald-100" : "bg-rose-100",
      subtitle: netReturnSubtitle
    }
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {metrics.map((metric, index) => (
        <Card key={index} className="border-slate-200 shadow-lg overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-start justify-between mb-2">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                {metric.title}
              </p>
              <div className={`p-2 rounded-lg ${metric.bgColor}`}>
                <metric.icon className={`w-4 h-4 ${metric.color}`} />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <p className={`text-lg font-bold ${metric.color}`}>
                {metric.value}
              </p>
              {metric.change && (
                <span className={`text-sm font-semibold ${metric.color}`}>
                  {metric.change}
                </span>
              )}
            </div>
            {metric.subtitle && (
              <p className="text-xs text-slate-500 mt-1">{metric.subtitle}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}