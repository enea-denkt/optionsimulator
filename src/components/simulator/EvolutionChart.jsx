
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, LineChart as LineChartIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

function payoffAtExpiration(spot, strike, optionType = 'call') {
  return optionType === 'call'
    ? Math.max(spot - strike, 0)
    : Math.max(strike - spot, 0);
}


// Binomial Tree Model for American Options
function calculateAmericanOptionPrice(
  spotPrice,
  strikePrice,
  timeToExpiry,
  volatility,
  riskFreeRate,
  optionType = 'call',
  steps = 100) {
  const T = timeToExpiry / 365;
  const v = volatility / 100;
  const r = riskFreeRate / 100;

  if (T <= 0) {
    if (optionType === 'call') {
      return Math.max(spotPrice - strikePrice, 0);
    } else {
      return Math.max(strikePrice - spotPrice, 0);
    }
  }

  const dt = T / steps;
  const u = Math.exp(v * Math.sqrt(dt));
  const d = 1 / u;
  const p = (Math.exp(r * dt) - d) / (u - d);
  const discount = Math.exp(-r * dt);

  const stockPrices = new Array(steps + 1);
  for (let i = 0; i <= steps; i++) {
    stockPrices[i] = spotPrice * Math.pow(u, steps - i) * Math.pow(d, i);
  }

  const optionValues = new Array(steps + 1);
  for (let i = 0; i <= steps; i++) {
    if (optionType === 'call') {
      optionValues[i] = Math.max(stockPrices[i] - strikePrice, 0);
    } else {
      optionValues[i] = Math.max(strikePrice - stockPrices[i], 0);
    }
  }

  for (let step = steps - 1; step >= 0; step--) {
    for (let i = 0; i <= step; i++) {
      const stockPrice = spotPrice * Math.pow(u, step - i) * Math.pow(d, i);
      const holdValue = discount * (p * optionValues[i] + (1 - p) * optionValues[i + 1]);

      let exerciseValue;
      if (optionType === 'call') {
        exerciseValue = Math.max(stockPrice - strikePrice, 0);
      } else {
        exerciseValue = Math.max(strikePrice - stockPrice, 0);
      }

      optionValues[i] = Math.max(holdValue, exerciseValue);
    }
  }

  return optionValues[0];
}

function getNextWeekday(date, daysToAdd) {
  const newDate = new Date(date);
  newDate.setDate(newDate.getDate() + daysToAdd);

  while (newDate.getDay() === 0 || newDate.getDay() === 6) {
    newDate.setDate(newDate.getDate() + 1);
  }

  return newDate;
}

function getHeatmapDates(expirationDate, daysToExpiration) {
  const dates = [];
  const expDate = new Date(expirationDate);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Determine interval based on days to expiration
  let intervalDays;
  let isMonthly = false;
  
  if (daysToExpiration <= 21) {
    // 3 weeks or less: daily
    intervalDays = 1;
  } else if (daysToExpiration <= 35) {
    // 5 weeks or less: 3 days per week (every ~2 days)
    intervalDays = 2;
  } else if (daysToExpiration <= 80) { // Updated threshold from 74 to 80
    // Up to ~11 weeks: 2 days per week (every ~3-4 days)
    intervalDays = 3;
  } else if (daysToExpiration <= 150) { // Updated threshold from 145 to 150
    // Up to ~21 weeks: weekly
    intervalDays = 7;
  } else if (daysToExpiration <= 333) {
    // Up to ~48 weeks: bi-weekly
    intervalDays = 14;
  } else if (daysToExpiration <= 394) {
    // Up to ~56 weeks: tri-weekly
    intervalDays = 21;
  } else {
    // More than 394 days: monthly
    isMonthly = true;
  }

  if (isMonthly) {
    // For monthly intervals, we want to add one date per month
    let currentDate = new Date(today);
    
    // Ensure we start on a weekday
    while (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    while (currentDate < expDate) {
      const daysRemaining = Math.round((expDate - currentDate) / (1000 * 60 * 60 * 24));
      dates.push({
        date: new Date(currentDate),
        daysRemaining: daysRemaining
      });
      
      // Move to the same day next month
      const nextMonth = new Date(currentDate);
      nextMonth.setMonth(currentDate.getMonth() + 1);
      
      // Ensure we land on a weekday
      while (nextMonth.getDay() === 0 || nextMonth.getDay() === 6) {
        nextMonth.setDate(nextMonth.getDate() + 1);
      }
      
      currentDate = nextMonth;
    }
  } else {
    // Use the fixed interval approach for non-monthly periods
    let currentDate = new Date(today);

    while (currentDate <= expDate) {
      if (currentDate.getDay() !== 0 && currentDate.getDay() !== 6) {
        const daysRemaining = Math.round((expDate - currentDate) / (1000 * 60 * 60 * 24));
        dates.push({
          date: new Date(currentDate),
          daysRemaining: daysRemaining
        });
      }

      currentDate = getNextWeekday(currentDate, intervalDays);
    }
  }

  // ALWAYS ensure the expiration date is included as the last column
  // Check if it's already in the list
  const lastDateInDates = dates.length > 0 ? dates[dates.length - 1].date : null;
  const isExpirationAlreadyIncluded = lastDateInDates && lastDateInDates.getTime() === expDate.getTime();
  
  if (!isExpirationAlreadyIncluded) {
    // If expiration is on a weekend, adjust to the previous Friday
    let finalExpDate = new Date(expDate);
    if (finalExpDate.getDay() === 0) { // Sunday
      finalExpDate.setDate(finalExpDate.getDate() - 2);
    } else if (finalExpDate.getDay() === 6) { // Saturday
      finalExpDate.setDate(finalExpDate.getDate() - 1);
    }
    
    dates.push({
      date: finalExpDate,
      daysRemaining: 0
    });
  }

  dates.sort((a, b) => a.date.getTime() - b.date.getTime());

  return dates;
}

const tooltipStyle = `
  .heatmap-cell {
    position: relative;
  }
  .heatmap-tooltip {
    display: none;
    position: absolute;
    top: -5px;
    left: 105%;
    background: white;
    color: black;
    padding: 6px 10px;
    border: 1px solid #ccc;
    border-radius: 6px;
    font-size: 11px;
    white-space: nowrap;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    z-index: 20;
  }
  .heatmap-cell:hover .heatmap-tooltip {
    display: block;
  }
`;


export default function EvolutionChart({ data, filters, premiumPaid }) {
  const [showReturn, setShowReturn] = useState(true);

  // Helper function for consistent date formatting
  const formatDateStandard = (dateObj) => {
    if (!dateObj) return '';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[dateObj.getMonth()];
    const day = dateObj.getDate();
    const year = dateObj.getFullYear().toString().slice(-2);
    return `${month} ${day}, '${year}`;
  };

  const generateHeatmapData = () => {
    const { currentPrice, strikePrice, daysToExpiration, currentIV, expectedIVChange, riskFreeRate, optionType, selectedContract, expectedPriceChange, entryPremium, simulationMode } = filters;

    // Always compute expiration from today's date + daysToExpiration (mobile-safe)
    const today = new Date();
    const expDateObj = new Date(today.getTime()); // copy
    expDateObj.setDate(expDateObj.getDate() + daysToExpiration);

    // Use ISO string for downstream logic
    const expirationDate = expDateObj.toISOString().split('T')[0];

    // ✅ Ensure getHeatmapDates is defined and returns an array
    const heatmapDates = typeof getHeatmapDates === 'function'
      ? getHeatmapDates(expirationDate, daysToExpiration)
      : [];



    const expectedPrice = currentPrice * (1 + expectedPriceChange / 100);
    const priceMin = Math.min(currentPrice, expectedPrice);
    const priceMax = Math.max(currentPrice, expectedPrice);
    // Ensure at least 2 points if priceMin === priceMax
    const priceSteps = priceMax === priceMin ? 1 : 20;
    const priceIncrement = priceMax === priceMin ? 0 : (priceMax - priceMin) / priceSteps;

    const heatmapData = [];

    const baselineForReturns = entryPremium !== null && entryPremium !== undefined ? entryPremium : premiumPaid;

    for (let dateInfo of heatmapDates) {
      // Calculate progress relative to the *original* daysToExpiration
      const progress = daysToExpiration > 0 ? (daysToExpiration - dateInfo.daysRemaining) / daysToExpiration : 0;
      const ivChangeAmount = currentIV * expectedIVChange / 100 * progress;
      const expectedIV = currentIV + ivChangeAmount;

      for (let p = 0; p <= priceSteps; p++) {
        const stockPrice = priceMin + p * priceIncrement;

        const optionValue = calculateAmericanOptionPrice(
          stockPrice,
          strikePrice,
          Math.max(dateInfo.daysRemaining, 0), // Ensure daysRemaining is non-negative
          expectedIV,
          riskFreeRate,
          optionType
        );

        const returnPercent = baselineForReturns > 0 ? (optionValue - baselineForReturns) / baselineForReturns * 100 : 0;

        heatmapData.push({
          date: dateInfo.date,
          dateStr: dateInfo.date.toISOString().split('T')[0], // Internal YYYY-MM-DD for lookups
          daysRemaining: dateInfo.daysRemaining,
          stockPrice: stockPrice,
          premium: optionValue,
          returnPercent: returnPercent,
          iv: expectedIV
        });
      }
    }

    return { heatmapData, heatmapDates };
  };

  const generatePayoffData = () => {
    const { currentPrice, strikePrice, currentIV, expectedIVChange, riskFreeRate, optionType, expectedPriceChange, entryPremium } = filters;

    const expectedIV = currentIV + currentIV * expectedIVChange / 100;

    // Use the same price range logic as the heatmap
    const expectedPrice = currentPrice * (1 + expectedPriceChange / 100);
    const priceMin = Math.min(currentPrice, expectedPrice);
    const priceMax = Math.max(currentPrice, expectedPrice);

    const priceSteps = 50;
    const priceIncrement = priceMax === priceMin ? 0 : (priceMax - priceMin) / priceSteps;

    const payoffData = [];

    const baselineForReturns = entryPremium !== null && entryPremium !== undefined ? entryPremium : premiumPaid;

    for (let i = 0; i <= priceSteps; i++) {
      const stockPrice = priceMin + i * priceIncrement;

      const optionValue = payoffAtExpiration(stockPrice,
        strikePrice,
        optionType
      );


      const netReturns = baselineForReturns > 0 ? (optionValue - baselineForReturns) / baselineForReturns * 100 : 0;

      // What the same move would have returned on the shares themselves,
      // bought at today's price — the benchmark the option has to beat.
      const stockReturns = currentPrice > 0 ? (stockPrice - currentPrice) / currentPrice * 100 : 0;

      payoffData.push({
        stockPrice: stockPrice,
        premium: optionValue,
        netReturns: netReturns,
        stockReturns: stockReturns,
        daysToExpiration: 0 // Consistent property for all data points
      });
    }

    return payoffData;
  };

  const generateFlatPriceDecayData = () => {
    const { currentPrice, strikePrice, daysToExpiration, currentIV, expectedIVChange, riskFreeRate, optionType } = filters;

    const decayData = [];
    const steps = Math.min(daysToExpiration, 50);
    // If daysToExpiration is 0, steps will be 0. Avoid division by zero for dayIncrement.
    const dayIncrement = steps > 0 ? daysToExpiration / steps : 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of day for date calculations

    // Calculate theoretical value today to get a reference for scaling
    const theoreticalValueToday = calculateAmericanOptionPrice(
      currentPrice,
      strikePrice,
      daysToExpiration, // Use the full initial days to expiry
      currentIV,
      riskFreeRate,
      optionType
    );

    // Scaling factor to make the decay line start exactly at premiumPaid
    // If theoreticalValueToday is 0, scalingFactor becomes 1. This means the chart will show the raw
    // theoretical decay from 0, unless premiumPaid is also 0.
    const scalingFactor = theoreticalValueToday > 0 ? premiumPaid / theoreticalValueToday : 1;

    for (let i = 0; i <= steps; i++) {
      const daysRemaining = Math.max(0, daysToExpiration - i * dayIncrement);
      // Progress from 0 (today) to 1 (expiration) based on steps passed
      const progress = daysToExpiration > 0 ? i / steps : 1;

      const ivChangeAmount = currentIV * expectedIVChange / 100 * progress;
      const evolvedIV = currentIV + ivChangeAmount;

      const theoreticalValue = calculateAmericanOptionPrice(
        currentPrice,
        strikePrice,
        daysRemaining, // Use the current step's days remaining
        evolvedIV,
        riskFreeRate,
        optionType
      );

      // Scale the theoretical value to align with the user's premiumPaid
      const optionValue = theoreticalValue * scalingFactor;

      // Calculate the actual calendar date for this point for display/tooltip
      const currentDate = new Date(today);
      currentDate.setDate(today.getDate() + Math.round(daysToExpiration - daysRemaining));

      const dateStr = formatDateStandard(currentDate);

      decayData.push({
        date: dateStr, // Formatted date string for display/tooltip
        premium: optionValue,
        stockPrice: currentPrice,
        daysToExpiration: Math.round(daysRemaining) // Numerical value for X-axis (days remaining)
      });
    }

    return decayData;
  };

  const payoffData = generatePayoffData();
  const todayForDecayChart = new Date();
  todayForDecayChart.setHours(0, 0, 0, 0);
  const decayData = generateFlatPriceDecayData();

  const { heatmapData, heatmapDates } = generateHeatmapData();

  const uniqueDates = heatmapDates.map((d) => d.date);

  const allPrices = heatmapData.map((d) => d.stockPrice);
  const maxPrice = allPrices.length > 0 ? Math.max(...allPrices) : 0;
  const useDecimals = maxPrice <= 100;

  const uniquePrices = [...new Set(heatmapData.map((d) => {
    if (useDecimals) {
      return parseFloat(d.stockPrice.toFixed(1));
    } else {
      return Math.round(d.stockPrice);
    }
  }))].sort((a, b) => b - a);

  const values = heatmapData.map((d) => showReturn ? d.returnPercent : d.premium);
  const minValue = values.length > 0 ? Math.min(...values) : 0;
  const maxValue = values.length > 0 ? Math.max(...values) : 0;

  const getColor = (value) => {
    if (showReturn) {
      if (value < 0) {
        const intensity = minValue < 0 ? Math.min(Math.abs(value) / Math.abs(minValue), 1) : 0;
        const r = 255;
        const g = Math.round(255 - intensity * 220);
        const b = Math.round(255 - intensity * 255);
        return `rgb(${r}, ${g}, ${b})`;
      } else {
        const intensity = maxValue > 0 ? Math.min(value / maxValue, 1) : 0;
        const r = Math.round(255 - intensity * 255);
        const g = Math.round(255 - intensity * 99);
        const b = Math.round(255 - intensity * 190);
        return `rgb(${r}, ${g}, ${b})`;
      }
    } else {
      const intensity = maxValue - minValue > 0 ? (value - minValue) / (maxValue - minValue) : 0;
      const r = Math.round(255 - intensity * (255 - 33));
      const g = Math.round(255 - intensity * (255 - 136));
      const b = Math.round(255 - intensity * (255 - 230));
      return `rgb(${r}, ${g}, ${b})`;
    }
  };

  const getValue = (date, price) => {
    const dateStr = date.toISOString().split('T')[0];
    const dataPoint = heatmapData.find((d) => {
      const dPrice = useDecimals ? parseFloat(d.stockPrice.toFixed(1)) : Math.round(d.stockPrice);
      return d.dateStr === dateStr && dPrice === price;
    });
    return dataPoint ? showReturn ? dataPoint.returnPercent : dataPoint.premium : 0;
  };

  const formatDateForHeader = (date) => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear().toString().slice(-2);
    return { month, day, year };
  };

  const dateHeaders = uniqueDates.map((date) => {
    const formatted = formatDateForHeader(date);
    return { date, month: formatted.month, day: formatted.day, year: formatted.year };
  });

  const cellWidth = 35;
  const cellHeight = 35;

  const PayoffTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const pointData = payload[0].payload;
      return (
        <div className="bg-white border-2 border-slate-200 rounded-lg shadow-xl p-4">
          <p className="text-sm text-slate-600 mb-1">
            Stock Price: <span className="font-semibold text-slate-900">${pointData.stockPrice.toFixed(2)}</span>
          </p>
          <p className="text-sm text-slate-600 mb-1">
            Premium: <span className="font-semibold text-slate-900">${pointData.premium.toFixed(2)}</span>
          </p>
          <p className="text-sm text-slate-600 mb-1">
            Net Return: <span className="font-semibold" style={{ color: pointData.netReturns >= 0 ? '#1DBC60' : '#FF2300' }}>{pointData.netReturns.toFixed(2)}%</span>
          </p>
          {pointData.stockReturns !== undefined && (
            <>
              <p className="text-sm text-slate-600 mb-1">
                Stock Return: <span className="font-semibold" style={{ color: pointData.stockReturns >= 0 ? '#1DBC60' : '#FF2300' }}>{pointData.stockReturns.toFixed(2)}%</span>
              </p>
              <p className="text-sm text-slate-600 pt-1 border-t border-slate-100">
                Option vs Stock: <span className="font-semibold text-slate-900">
                  {(pointData.netReturns - pointData.stockReturns > 0 ? '+' : '') + (pointData.netReturns - pointData.stockReturns).toFixed(2)} pp
                </span>
              </p>
            </>
          )}
        </div>);

    }
    return null;
  };

  const DecayTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const pointData = payload[0].payload;
      return (
        <div className="bg-white border-2 border-slate-200 rounded-lg shadow-xl p-4">
          <p className="text-sm text-slate-600 mb-1">
            Date: <span className="font-semibold text-slate-900">{pointData.date}</span>
          </p>
          <p className="text-sm text-slate-600 mb-1">
            Days to Expiration: <span className="font-semibold text-slate-900">{pointData.daysToExpiration}</span>
          </p>
          <p className="text-sm text-slate-600 mb-1">
            Stock Price: <span className="font-semibold text-slate-900">${pointData.stockPrice.toFixed(2)}</span>
          </p>
          <p className="text-sm text-slate-600">
            Premium: <span className="font-semibold text-slate-900">${pointData.premium.toFixed(2)}</span>
          </p>
        </div>);

    }
    return null;
  };

  const getLineColor = (value) => {
    return value >= 0 ? '#1DBC60' : '#FF2300';
  };

  const createColoredSegments = (dataArray) => {
    const segments = [];
    let currentSegment = [];
    let currentColor = null;

    for (let i = 0; i < dataArray.length; i++) {
      const point = dataArray[i];
      const color = getLineColor(point.netReturns);

      if (i === 0) {
        currentColor = color;
        currentSegment.push(point);
      } else {
        const prevPoint = dataArray[i - 1];
        if (color !== currentColor) {
          if (prevPoint.netReturns < 0 && point.netReturns >= 0 || prevPoint.netReturns >= 0 && point.netReturns < 0) {
            const t = Math.abs(prevPoint.netReturns) / (Math.abs(prevPoint.netReturns) + Math.abs(point.netReturns));

            const crossingPoint = {
              stockPrice: prevPoint.stockPrice + t * (point.stockPrice - prevPoint.stockPrice),
              premium: prevPoint.premium + t * (point.premium - prevPoint.premium),
              netReturns: 0,
              stockReturns: prevPoint.stockReturns + t * (point.stockReturns - prevPoint.stockReturns),
              daysToExpiration: prevPoint.daysToExpiration
            };
            currentSegment.push(crossingPoint);
            segments.push({ data: currentSegment, color: currentColor });
            currentSegment = [crossingPoint, point];
            currentColor = color;
          } else {
            segments.push({ data: currentSegment, color: currentColor });
            currentSegment = [point];
            currentColor = color;
          }
        }
        else {
          currentSegment.push(point);
        }
      }
    }

    if (currentSegment.length > 0) {
      segments.push({ data: currentSegment, color: currentColor });
    }

    return segments;
  };

  const payoffSegments = createColoredSegments(payoffData);

  const maxReturnValue = payoffData.length > 0 ? Math.max(...payoffData.map((d) => Math.abs(d.netReturns))) : 0;
  const yAxisTickStyle = maxReturnValue > 900 ? { fontSize: '11px' } : undefined;

  const createPremiumColoredSegments = (dataArray, entryPremium, initialTodayRef, initialDaysToExpirationRef) => {
    if (!entryPremium) {
      return [{ data: dataArray, color: '#2188e6' }];
    }

    const segments = [];
    let currentSegment = [];
    let currentColor = null;

    for (let i = 0; i < dataArray.length; i++) {
      const point = dataArray[i];
      const color = point.premium >= entryPremium ? '#1DBC60' : '#FF2300';

      if (i === 0) {
        currentColor = color;
        currentSegment.push(point);
      } else {
        const prevPoint = dataArray[i - 1];
        if (color !== currentColor) {
          if (prevPoint.premium < entryPremium && point.premium >= entryPremium ||
            prevPoint.premium >= entryPremium && point.premium < entryPremium) {

            const t = Math.abs(prevPoint.premium - entryPremium) / Math.abs(point.premium - prevPoint.premium);

            const interpolatedDaysToExpiration = prevPoint.daysToExpiration + t * (point.daysToExpiration - prevPoint.daysToExpiration);

            let interpolatedDateStr = '';
            if (initialTodayRef && initialDaysToExpirationRef !== undefined) {
              const interpolatedRawDate = new Date(initialTodayRef);
              interpolatedRawDate.setDate(initialTodayRef.getDate() + (initialDaysToExpirationRef - interpolatedDaysToExpiration));
              interpolatedDateStr = formatDateStandard(interpolatedRawDate);
            }

            const crossingPoint = {
              daysToExpiration: interpolatedDaysToExpiration,
              premium: entryPremium,
              stockPrice: prevPoint.stockPrice + t * (point.stockPrice - prevPoint.stockPrice),
              date: interpolatedDateStr
            };

            currentSegment.push(crossingPoint);
            segments.push({ data: currentSegment, color: currentColor });
            currentSegment = [crossingPoint, point];
            currentColor = color;
          } else {
            segments.push({ data: currentSegment, color: currentColor });
            currentSegment = [point];
            currentColor = color;
          }
        } else {
          currentSegment.push(point);
        }
      }
    }

    if (currentSegment.length > 0) {
      segments.push({ data: currentSegment, color: currentColor });
    }

    return segments;
  };

  const premiumSegments = createPremiumColoredSegments(decayData, filters.entryPremium, todayForDecayChart, filters.daysToExpiration);

  return (
    <>
    <style>{tooltipStyle}</style>
    <div className="w-full overflow-x-auto">
        <Card className="border-slate-200 shadow-xl mb-6">
          <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white pb-8">
            <CardTitle className="text-xl font-semibold text-slate-900 flex items-center gap-2">
              <LineChartIcon className="w-5 h-5" style={{ color: '#A0CBF5' }} />
              Net Return (%) and Stock Return (%) vs Stock Price at Expiration
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            {/* Legend sits above the plot: the option line switches colour with
                profit and loss, so it needs a two-tone swatch rather than one. */}
            <div className="flex flex-wrap items-center gap-6 mb-4 px-2">
              <div className="flex items-center gap-2">
                <svg width="34" height="10" aria-hidden="true">
                  <line x1="0" y1="5" x2="17" y2="5" stroke="#FF2300" strokeWidth="2.5" />
                  <line x1="17" y1="5" x2="34" y2="5" stroke="#1DBC60" strokeWidth="2.5" />
                </svg>
                <span className="text-sm text-slate-600">
                  Option Net Return <span className="text-slate-400">(loss / profit)</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <svg width="34" height="10" aria-hidden="true">
                  <line x1="0" y1="5" x2="34" y2="5" stroke="#2188e6" strokeWidth="2.5" strokeDasharray="5 4" />
                </svg>
                <span className="text-sm text-slate-600">
                  Stock Return <span className="text-slate-400">(if you bought shares instead)</span>
                </span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart margin={{ top: 20, right: 30, left: 60, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="stockPrice"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(value) => `$${value.toFixed(0)}`}
                  stroke="#64748b"
                  label={{ value: 'Stock Price', position: 'insideBottom', offset: -20 }} />


                <YAxis
                  domain={['auto', 'auto']}
                  label={{ value: 'Return', angle: -90, position: 'insideLeft', offset: -10 }}
                  stroke="#64748b"
                  tickFormatter={(value) => `${value}%`}
                  tick={yAxisTickStyle} />


                <Tooltip content={<PayoffTooltip />} />
                <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 5" />

                {/* Buy-the-shares benchmark, drawn under the option line */}
                <Line
                  data={payoffData}
                  type="monotone"
                  dataKey="stockReturns"
                  stroke="#2188e6"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={false}
                  connectNulls
                  isAnimationActive={false} />

                {payoffSegments.map((segment, index) =>
                  <Line
                    key={index}
                    data={segment.data}
                    type="monotone"
                    dataKey="netReturns"
                    stroke={segment.color}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                    isAnimationActive={false} />

                )}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="w-full overflow-x-auto">
        <Card className="border-slate-200 shadow-xl mb-6">
          <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white pb-8">
            <CardTitle className="text-xl font-semibold text-slate-900 flex items-center gap-2">
              <LineChartIcon className="w-5 h-5" style={{ color: '#A0CBF5' }} />
              Premium Decay if Stock Price Stays Flat
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart margin={{ top: 20, right: 30, left: 60, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="daysToExpiration"
                  type="number"
                  domain={[0, 'dataMax']}
                  reversed={true}
                  tickFormatter={(value) => {
                    if (todayForDecayChart && filters.daysToExpiration !== undefined) {
                      const currentDisplayDate = new Date(todayForDecayChart);
                      currentDisplayDate.setDate(todayForDecayChart.getDate() + (filters.daysToExpiration - value));
                      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                      const month = months[currentDisplayDate.getMonth()];
                      const day = currentDisplayDate.getDate();
                      const year = currentDisplayDate.getFullYear().toString().slice(-2);
                      return `${month} ${day}, '${year}`;
                    }
                    return '';
                  }}
                  stroke="#64748b"
                  label={{ value: 'Date', position: 'insideBottom', offset: -20 }} />

                <YAxis
                  label={{ value: 'Premium', angle: -90, position: 'insideLeft', offset: 0 }}
                  stroke="#64748b"
                  tickFormatter={(value) => `$${value.toFixed(1)}`} />

                <Tooltip content={<DecayTooltip />} />
                {filters.entryPremium &&
                  <ReferenceLine
                    y={filters.entryPremium}
                    stroke="#94a3b8"
                    strokeWidth={2}
                    strokeDasharray="5 5" />

                }
                {premiumSegments.map((segment, index) =>
                  <Line
                    key={index}
                    data={segment.data}
                    type="monotone"
                    dataKey="premium"
                    stroke={segment.color}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                    isAnimationActive={false} />

                )}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="w-full overflow-x-auto">            
      <Card className="border-slate-200 shadow-xl">
        <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white pb-8">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl font-semibold text-slate-900 flex items-center gap-2">
              <TrendingUp className="w-5 h-5" style={{ color: '#A0CBF5' }} />
              Option Value Heatmap
            </CardTitle>
            <div className="flex items-center gap-3">
              <Label htmlFor="view-toggle" className="text-sm font-medium">
                {showReturn ? 'Net Return (%)' : 'Premium ($)'}
              </Label>
              <Switch
                id="view-toggle"
                checked={!showReturn}
                onCheckedChange={(checked) => setShowReturn(!checked)} />

            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6 overflow-auto">
          <div className="inline-block">
            <div className="mb-2 text-center" style={{ width: `calc(${cellWidth * uniqueDates.length}px + 80px)` }}>
              <p className="text-gray-400 text-base font-medium">Date</p>
            </div>

            <div style={{ display: 'flex' }}>
              <div style={{ display: 'flex', flexDirection: 'column', width: '30px', marginRight: '5px' }}>
                <div style={{ height: `${cellHeight * 2 + 38}px`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <p className="text-gray-400 text-base font-medium" style={{ writingMode: 'vertical-lr', textOrientation: 'mixed', transform: 'rotate(180deg)' }}>Stock Price</p>
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', marginBottom: '2px', height: '15px' }}>
                  <div style={{ width: '80px' }}></div>
                  {dateHeaders.map((header, idx) => {
                    const showMonthBlock = idx === 0 || header.month !== dateHeaders[idx - 1].month;
                    let displayText = '';
                    if (showMonthBlock) {
                      const isJanuary = header.date.getMonth() === 0;
                      if (idx === 0) {
                        // For the very first column, always show month with year for context
                        displayText = `${header.month} '${header.year}`;
                      } else if (isJanuary) {
                        // For subsequent months, if it's January, show month with year
                        displayText = `${header.month} '${header.year}`;
                      } else {
                        // For subsequent months, if it's not January, just show the month
                        displayText = header.month;
                      }
                    }
                    return (
                      <div
                        key={idx}
                        style={{
                          width: `${cellWidth}px`,
                          textAlign: 'center',
                          fontSize: '11px',
                          fontWeight: '600',
                          color: '#475569',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        {displayText}
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', marginBottom: '5px', height: '16px' }}>
                  <div style={{ width: '80px' }}></div>
                  {dateHeaders.map((header, idx) =>
                    <div
                      key={idx}
                      style={{
                        width: `${cellWidth}px`,
                        textAlign: 'center',
                        fontSize: '11px',
                        fontWeight: '500',
                        color: '#64748b',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>

                      {header.day}
                    </div>
                  )}
                </div>

                {uniquePrices.map((price, priceIdx) =>
                  <div key={priceIdx} style={{ display: 'flex' }}>
                    <div
                      style={{
                        width: '80px',
                        height: `${cellHeight}px`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        paddingRight: '10px',
                        fontSize: '11px',
                        fontWeight: '500',
                        color: '#64748b',
                        backgroundColor: 'transparent'
                      }}
                    >
                      ${useDecimals ? price.toFixed(1) : price.toFixed(0)}
                    </div>

                    {uniqueDates.map((date, dayIdx) => {
                      const value = getValue(date, price);
                      const color = getColor(value);

                      return (
                        <div
                          key={dayIdx}
                          className="heatmap-cell"
                          style={{
                            width: `${cellWidth}px`,
                            height: `${cellHeight}px`,
                            backgroundColor: color,
                            border: '1px solid #e2e8f0',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '9px',
                            fontWeight: '600',
                            color: '#1e293b',
                            cursor: 'pointer'
                          }}
                        >
                          {showReturn ? value.toFixed(0) + '%' : '$' + value.toFixed(1)}

                          {/* Tooltip */}
                          <div className="heatmap-tooltip">
                            <div><strong>Date:</strong> {formatDateStandard(date)}</div>
                            <div><strong>Stock:</strong> ${price.toFixed(2)}</div>
                            <div><strong>Premium:</strong> ${getValue(date, price).toFixed(2)}</div>
                            <div><strong>Net Return:</strong> {value.toFixed(1)}%</div>
                          </div>
                        </div>);

                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-center gap-4">
            <div className="text-xs font-medium text-slate-600">
              {showReturn ? 'Return Range:' : 'Premium Range:'}
            </div>
            <div className="text-xs">{showReturn ? minValue.toFixed(0) + '%' : '$' + minValue.toFixed(2)}</div>
            <div style={{
              width: '200px',
              height: '20px',
              background: showReturn ?
                'linear-gradient(to right, rgb(255, 35, 0), rgb(255, 255, 255), rgb(0, 156, 65))' :
                'linear-gradient(to right, rgb(255, 255, 255), rgb(33, 136, 230))',
              borderRadius: '4px'
            }} />
            <div className="text-xs">{showReturn ? maxValue.toFixed(0) + '%' : '$' + maxValue.toFixed(2)}</div>
          </div>
        </CardContent>
      </Card>
    </div>
    </>
  );
}