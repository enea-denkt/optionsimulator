
import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, DollarSign, Activity } from "lucide-react";


function payoffAtExpiration(spot, strike, optionType = 'call') {
  return optionType === 'call'
    ? Math.max(spot - strike, 0)
    : Math.max(strike - spot, 0);
}


export default function MetricsSummary({ data, initialValue, premiumPaid, filters }) {
  // `riskFreeRate` and `daysToExpiration` used to be pulled in here and never
  // read, which is the kind of leftover that makes a reader conclude the payoff
  // below is *meant* to discount and has a bug. It is not: a payoff at expiry
  // needs neither a rate nor a time to expiry. `expectedIV` stays because the
  // volatility card genuinely shows it.
  const { currentPrice, strikePrice, currentIV, expectedIVChange, expectedPriceChange, optionType, entryPremium } = filters;
  
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
      // Not "Expected Premium": this is the payoff on expiry day, which is a
      // different quantity from a premium and behaves differently. A reviewer
      // set price and volatility changes to zero, read $0.00 next to a $2.03
      // premium, and concluded the pricing model was broken — reasonably, given
      // what the card said. An at-the-money put that expires unmoved really is
      // worth nothing, and no volatility view can change that, because there is
      // no time value left at expiry for volatility to price.
      title: "Payoff at Expiration",
      value: `$${expectedPremium.toFixed(2)}`,
      // No percentage badge here. It was `premiumChange`, the step from today's
      // premium to the expiry payoff, rendered exactly like the price and
      // volatility changes on the cards beside it — which made a comparison of
      // two different quantities look like a move in one. It was also the same
      // number as Expected Net Return next door whenever no entry premium is
      // set, so the row showed one figure twice and mislabelled a copy of it.
      subtitle: `On expiry day · premium now $${premiumPaid.toFixed(2)}`,
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