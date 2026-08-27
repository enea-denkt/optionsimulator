
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import OptionsFilters from '../components/simulator/OptionsFilters';
import EvolutionChart from '../components/simulator/EvolutionChart';
import MetricsSummary from '../components/simulator/MetricsSummary';
import { Activity, TrendingUp } from 'lucide-react';
import { useUrlState, asString, asNumber, asNullableNumber, asEnum } from '@/lib/useUrlState';
// One binomial tree serves this page and the contract finder, so a contract
// cannot be worth one number here and another there.
import { americanOptionPrice as calculateAmericanOptionPrice } from '@/lib/contractScreener';
import { getLastTicker, setLastTicker } from '@/lib/tickerMemory';

function payoffAtExpiration(spot, strike, optionType = 'call') {
  return optionType === 'call'
    ? Math.max(spot - strike, 0)
    : Math.max(strike - spot, 0);
}


function generateEvolutionData(filters) {
  const {
    currentPrice,
    strikePrice,
    daysToExpiration,
    currentIV,
    expectedIVChange,
    expectedPriceChange,
    riskFreeRate,
    optionType,
    premiumPaid
  } = filters;

  const data = [];
  const steps = Math.min(daysToExpiration, 50); // Limit steps to avoid excessive computation for very long DTE
  const dayIncrement = daysToExpiration / steps;

  let initialTheoreticalValue = 0;

  // Only generate data if a contract is selected, otherwise data will be empty and initial value 0
  if (filters.selectedContract || filters.simulationMode === 'free') {
    initialTheoreticalValue = calculateAmericanOptionPrice(
      currentPrice,
      strikePrice,
      daysToExpiration,
      currentIV,
      riskFreeRate,
      optionType
    );

    for (let i = 0; i <= steps; i++) {
      const daysRemaining = daysToExpiration - i * dayIncrement;
      const progress = i / steps;

      // Calculate expected stock price change
      const priceChangeAmount = currentPrice * (expectedPriceChange / 100) * progress;
      const expectedStockPrice = currentPrice + priceChangeAmount;

      // Calculate expected IV change
      const ivChangeAmount = currentIV * expectedIVChange / 100 * progress;
      const expectedIV = currentIV + ivChangeAmount;

      // Calculate theoretical option value at this point in time
      const theoreticalValue = calculateAmericanOptionPrice(
        expectedStockPrice,
        strikePrice,
        Math.max(daysRemaining, 0), // Ensure daysRemaining is not negative
        expectedIV,
        riskFreeRate,
        optionType
      );

      // Premium evolution: starts from premiumPaid and evolves proportionally to theoretical value
      // This assumes the "market price" (premium) of the option tracks its theoretical value.
      let premium = premiumPaid * (initialTheoreticalValue > 0 ? theoreticalValue / initialTheoreticalValue : 1);
      // If we've reached expiration, snap to intrinsic payoff for consistency
      if (daysRemaining <= 0) {
        premium = payoffAtExpiration(expectedStockPrice, strikePrice, optionType);
      }


      const pnl = premium - premiumPaid;
      const pnlPercent = premiumPaid > 0 ? pnl / premiumPaid * 100 : 0;

      data.push({
        day: Math.round(daysRemaining),
        value: theoreticalValue, // This is the theoretical value
        premium: premium, // This is the evolving market premium
        stockPrice: expectedStockPrice,
        iv: expectedIV,
        pnl: pnl,
        pnlPercent: pnlPercent
      });
    }
  }

  return { data, initialValue: initialTheoreticalValue };
}

const DEFAULT_FILTERS = {
  ticker: '',
  currentPrice: 0,
  strikePrice: 175,
  optionType: 'call',
  selectedContract: '', // Initially no contract selected
  selectedOcc: '',      // OCC symbol — the contract's unique identity
  daysToExpiration: 90,
  scenario: 'neutral',
  expectedPriceChange: 5,
  currentIV: 30,
  expectedIVChange: 0,
  riskFreeRate: 4,
  premiumPaid: 0,
  entryPremium: null,
  simulationMode: 'ticker'
};

/**
 * What travels in the URL.
 *
 * In ticker mode the contract is carried as its OCC symbol alone: strike,
 * expiration, premium and IV are re-read from the live chain when the link is
 * opened, so a shared link shows current quotes rather than a snapshot of
 * whatever they were when it was copied. `selectedContract` is a display label
 * derived from the same symbol, so it stays out.
 *
 * In free mode there is no chain to read from, so the typed numbers travel
 * instead. They are listed unconditionally — a parameter only appears when it
 * differs from the default, so ticker-mode links do not carry them anyway.
 */
const URL_SPEC = {
  simulationMode: { ...asEnum(['ticker', 'free'], 'ticker'), param: 'mode' },
  ticker: asString(''),
  optionType: { ...asEnum(['call', 'put'], 'call'), param: 'type' },
  selectedOcc: { ...asString(''), param: 'occ' },
  currentPrice: { ...asNumber(0), param: 'price' },
  strikePrice: { ...asNumber(175), param: 'strike' },
  premiumPaid: { ...asNumber(0), param: 'premium' },
  entryPremium: { ...asNullableNumber(null), param: 'entry' },
  daysToExpiration: { ...asNumber(90), param: 'dte' },
  currentIV: { ...asNumber(30), param: 'iv' },
  expectedPriceChange: { ...asNumber(5), param: 'move' },
  expectedIVChange: { ...asNumber(0), param: 'ivmove' },
  riskFreeRate: { ...asNumber(4), param: 'rate' },
  scenario: { ...asEnum(['bullish', 'neutral', 'bearish'], 'neutral'), param: 'scenario' },
};

export default function OptionsSimulator() {
  // Opens on whichever ticker was last looked at, unless this URL names one.
  const [filters, setFilters] = useUrlState(URL_SPEC, DEFAULT_FILTERS, {
    initial: { ticker: getLastTicker() },
  });

  useEffect(() => {
    if (filters.ticker) setLastTicker(filters.ticker);
  }, [filters.ticker]);

  const [simulationData, setSimulationData] = useState({ data: [], initialValue: 0 });


  useEffect(() => {
    let active = true;
  
    if (filters.selectedContract || filters.simulationMode === 'free') {
      // Delay generation slightly to let mobile browsers finish layout
      setTimeout(() => {
        if (!active) return;
        const result = generateEvolutionData(filters);
        setSimulationData(result);
      }, 50);
    } else {
      setSimulationData({ data: [], initialValue: 0 });
    }
  
    return () => { active = false; };
  }, [filters]);
  

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 overflow-x-hidden">
      <div className="bg-[#FFFFFF] mx-auto px-4 py-6 w-full max-w-full">

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="bg-white rounded-xl border border-slate-200 shadow-lg p-8 mb-8">

          <h2 className="text-2xl font-bold text-slate-900 mb-4">Options Simulator</h2>
          <div className="space-y-4 text-slate-600">
            <p className="leading-relaxed">
              GammaLift Options Simulator helps you analyze how option values and returns evolve under different market scenarios. You can work in two modes: <strong>Ticker-linked mode</strong> to select real contracts with auto-filled market data, or <strong>Freeform mode</strong> to manually customize all parameters for theoretical analysis.
            </p>

            <div className="grid md:grid-cols-2 gap-6 mt-6">
              <div className="bg-sky-50 p-5 rounded-lg border border-indigo-100">
                <h3 className="font-semibold text-indigo-900 mb-2 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5" />
                  Key Concepts
                </h3>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="text-indigo-600">•</span>
                    <span><strong>Current Premium:</strong> The market price of the option right now</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-indigo-600">•</span>
                    <span><strong>Entry Premium:</strong> Optional field to set your actual purchase price for P&L tracking</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-indigo-600">•</span>
                    <span><strong>Expected Premium:</strong> Projected option value at expiration under your scenario</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-indigo-600">•</span>
                    <span><strong>Net Return:</strong> Your profit/loss percentage from Entry Premium (or Current Premium if not set)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-indigo-600">•</span>
                    <span>Model extreme scenarios from -100% to +600% price movements</span>
                  </li>
                </ul>
              </div>

              <div className="bg-emerald-50 rounded-lg p-5 border border-emerald-100">
                <h3 className="font-semibold text-emerald-900 mb-2 flex items-center gap-2">
                  <Activity className="w-5 h-5" />
                  How to Use
                </h3>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-600">1.</span>
                    <span>Choose between Ticker-linked or Freeform simulation mode</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-600">2.</span>
                    <span>In Ticker mode: select a ticker and contract. In Freeform: customize all parameters</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-600">3.</span>
                    <span>Set Entry Premium if you want to track returns from a specific purchase price</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-600">4.</span>
                    <span>Adjust expected price change, IV change, and other market scenarios</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-600">5.</span>
                    <span>Analyze Net Return chart, Premium Decay, and the interactive heatmap</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </motion.div>

        {(filters.selectedContract || filters.simulationMode === 'free') &&
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}>

            <MetricsSummary
            data={simulationData.data}
            initialValue={simulationData.initialValue}
            premiumPaid={filters.premiumPaid}
            filters={filters} />

          </motion.div>
        }

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6 w-full overflow-hidden">

          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="lg:col-span-1">

            <OptionsFilters filters={filters} onChange={setFilters} />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="lg:col-span-2">

            {filters.selectedContract || filters.simulationMode === 'free' ?
            <>
                <div className="mb-6 p-6 bg-slate-50 rounded-xl border border-slate-200">
                  <h3 className="text-sm font-semibold text-slate-700 mb-3">Simulation Assumptions</h3>
                  <div className="grid md:grid-cols-2 gap-4 text-sm text-slate-600">
                    <div>
                      <p className="mb-1"><span className="font-medium">Ticker:</span> {filters.ticker}</p>
                      <p className="mb-1"><span className="font-medium">Stock Price:</span> ${filters.currentPrice.toFixed(2)}</p>
                      <p className="mb-1"><span className="font-medium">Option Type:</span> {filters.optionType.charAt(0).toUpperCase() + filters.optionType.slice(1)}</p>
                      <p className="mb-1">
                        <span className="font-medium">Contract:</span> {
                      filters.simulationMode === 'free' ?
                      (() => {
                        const today = new Date();
                        const expDate = new Date(today);
                        expDate.setDate(expDate.getDate() + filters.daysToExpiration);
                        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                        const month = months[expDate.getMonth()];
                        const day = expDate.getDate();
                        const year = expDate.getFullYear().toString().slice(-2);
                        return `${filters.strikePrice} - ${month} ${day}, '${year}`;
                      })() :
                      filters.selectedContract || 'N/A'
                      }
                      </p>
                      <p className="mb-1"><span className="font-medium">Premium:</span> ${filters.premiumPaid.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="mb-1"><span className="font-medium">Scenario:</span> {filters.scenario.charAt(0).toUpperCase() + filters.scenario.slice(1)}</p>
                      <p className="mb-1"><span className="font-medium">Stock Price Change:</span> {filters.expectedPriceChange > 0 ? '+' : ''}{filters.expectedPriceChange}% (${(filters.currentPrice * (1 + filters.expectedPriceChange / 100)).toFixed(2)})</p>
                      <p className="mb-1"><span className="font-medium">IV Change:</span> {filters.expectedIVChange > 0 ? '+' : ''}{filters.expectedIVChange}% ({(filters.currentIV + filters.currentIV * filters.expectedIVChange / 100).toFixed(1)}%)</p>
                      <p className="mb-1"><span className="font-medium">Risk-free Rate:</span> {filters.riskFreeRate}%</p>
                      <p className="mb-1"><span className="font-medium">Model:</span> Binomial Tree (American-style options)</p>
                    </div>
                  </div>

                  <div className="mt-6 pt-6 border-t border-slate-300">
                    <h3 className="text-sm font-semibold text-slate-700 mb-3">Simulation Results</h3>
                    <div className="grid md:grid-cols-2 gap-4 text-sm text-slate-600">
                      {/* Left Column */}
                      <div>
                        <p className="mb-1">
                          <span className="font-medium">Expected Option Premium:</span>{' '}
                          <span className="font-bold" style={{
                            color: (() => {
                              const { currentPrice, strikePrice, expectedPriceChange, currentIV, expectedIVChange, riskFreeRate, optionType, premiumPaid } = filters;
                              const expectedStockPrice = currentPrice * (1 + expectedPriceChange / 100);
                              const expectedIV = Math.max(5, Math.min(500, currentIV + currentIV * expectedIVChange / 100));
                              const expectedPremium = payoffAtExpiration(
                                expectedStockPrice,
                                strikePrice,
                                optionType
                              );
                              const baselineForReturns = premiumPaid;
                              const expectedReturns = baselineForReturns > 0 ? (expectedPremium - baselineForReturns) / baselineForReturns * 100 : 0;
                              return expectedReturns >= 0 ? '#1DBC60' : '#FF2300';
                            })()
                          }}>
                            {(() => {
                              const { currentPrice, strikePrice, expectedPriceChange, currentIV, expectedIVChange, riskFreeRate, optionType } = filters;
                              const expectedStockPrice = currentPrice * (1 + expectedPriceChange / 100);
                              const expectedIV = Math.max(5, Math.min(500, currentIV + currentIV * expectedIVChange / 100));
                              const expectedPremium = payoffAtExpiration(
                                expectedStockPrice,
                                strikePrice,
                                optionType
                              );
                              
                              return expectedPremium.toFixed(2);
                            })()}
                          </span>
                        </p>

                        <p className="mb-1">
                          <span className="font-medium">Expected Option Net Return (%)*:</span>{' '}
                          <span className="font-bold" style={{
                            color: (() => {
                              const { currentPrice, strikePrice, expectedPriceChange, currentIV, expectedIVChange, riskFreeRate, optionType, premiumPaid, entryPremium } = filters;
                              const expectedStockPrice = currentPrice * (1 + expectedPriceChange / 100);
                              const expectedIV = Math.max(5, Math.min(500, currentIV + currentIV * expectedIVChange / 100));
                              const expectedPremium = payoffAtExpiration(
                                expectedStockPrice,
                                strikePrice,
                                optionType
                              );
                              const baselineForReturns = entryPremium !== null && entryPremium !== undefined && entryPremium !== 0 ? entryPremium : premiumPaid;
                              const expectedReturns = baselineForReturns > 0 ? (expectedPremium - baselineForReturns) / baselineForReturns * 100 : 0;
                              return expectedReturns >= 0 ? '#1DBC60' : '#FF2300';
                            })()
                          }}>
                            {(() => {
                              const { currentPrice, strikePrice, expectedPriceChange, currentIV, expectedIVChange, riskFreeRate, optionType, premiumPaid, entryPremium } = filters;
                              const expectedStockPrice = currentPrice * (1 + expectedPriceChange / 100);
                              const expectedIV = Math.max(5, Math.min(500, currentIV + currentIV * expectedIVChange / 100));
                              const expectedPremium = calculateAmericanOptionPrice(
                                expectedStockPrice,
                                strikePrice,
                                0,
                                expectedIV,
                                riskFreeRate,
                                optionType
                              );
                              const baselineForReturns = entryPremium !== null && entryPremium !== undefined && entryPremium !== 0 ? entryPremium : premiumPaid;
                              const expectedReturns = baselineForReturns > 0 ? (expectedPremium - baselineForReturns) / baselineForReturns * 100 : 0;
                              return (expectedReturns > 0 ? '+' : '') + expectedReturns.toFixed(2);
                            })()}%
                          </span>
                        </p>

                        
                      </div>

                      {/* Right Column */}
                      <div>
                      <p className="mb-1">
                          <span className="font-medium">Expected Stock Returns (%):</span>{' '}
                          <span className="font-bold" style={{
                            color: (() => {
                              const { currentPrice, expectedPriceChange } = filters;
                              const expectedStockPrice = currentPrice * (1 + expectedPriceChange / 100);
                              const stockReturn = ((expectedStockPrice - currentPrice) / currentPrice) * 100;
                              return stockReturn >= 0 ? '#1DBC60' : '#FF2300';
                            })()
                          }}>
                            {(() => {
                              const { currentPrice, expectedPriceChange } = filters;
                              const expectedStockPrice = currentPrice * (1 + expectedPriceChange / 100);
                              const stockReturn = ((expectedStockPrice - currentPrice) / currentPrice) * 100;
                              return (stockReturn > 0 ? '+' : '') + stockReturn.toFixed(2);
                            })()}%
                          </span>
                        </p>

                        <p className="mb-1">
                          <span className="font-medium">Expected Incremental Returns of Options vs Stock (pp)**:</span>{' '}
                          <span className="font-bold" style={{
                            color: (() => {
                              const { currentPrice, strikePrice, expectedPriceChange, currentIV, expectedIVChange, riskFreeRate, optionType, premiumPaid, entryPremium } = filters;
                              const expectedStockPrice = currentPrice * (1 + expectedPriceChange / 100);
                              const expectedIV = Math.max(5, Math.min(500, currentIV + currentIV * expectedIVChange / 100));
                              const expectedPremium = calculateAmericanOptionPrice(
                                expectedStockPrice,
                                strikePrice,
                                0,
                                expectedIV,
                                riskFreeRate,
                                optionType
                              );
                              const baselineForReturns = entryPremium !== null && entryPremium !== undefined && entryPremium !== 0 ? entryPremium : premiumPaid;
                              const optionNetReturn = baselineForReturns > 0 ? (expectedPremium - baselineForReturns) / baselineForReturns * 100 : 0;
                              const stockReturn = ((expectedStockPrice - currentPrice) / currentPrice) * 100;
                              const incrementalReturn = optionNetReturn - stockReturn;
                              return incrementalReturn >= 0 ? '#1DBC60' : '#FF2300';
                            })()
                          }}>
                            {(() => {
                              const { currentPrice, strikePrice, expectedPriceChange, currentIV, expectedIVChange, riskFreeRate, optionType, premiumPaid, entryPremium } = filters;
                              const expectedStockPrice = currentPrice * (1 + expectedPriceChange / 100);
                              const expectedIV = Math.max(5, Math.min(500, currentIV + currentIV * expectedIVChange / 100));
                              const expectedPremium = calculateAmericanOptionPrice(
                                expectedStockPrice,
                                strikePrice,
                                0,
                                expectedIV,
                                riskFreeRate,
                                optionType
                              );
                              const baselineForReturns = entryPremium !== null && entryPremium !== undefined && entryPremium !== 0 ? entryPremium : premiumPaid;
                              const optionNetReturn = baselineForReturns > 0 ? (expectedPremium - baselineForReturns) / baselineForReturns * 100 : 0;
                              const stockReturn = ((expectedStockPrice - currentPrice) / currentPrice) * 100;
                              const incrementalReturn = optionNetReturn - stockReturn;
                              return (incrementalReturn > 0 ? '+' : '') + incrementalReturn.toFixed(2) + ' pp';
                            })()}
                          </span>
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 mt-4">
                      *Option Net Return is the percentage gain or loss on your option position at expiration, calculated as the change between its final payoff and the premium you paid. If you haven't provided an Entry Premium ($), Current Premium ($) is used.
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      **Incremental Returns show the absolute difference in percentage points (pp) between option returns and stock returns.
                    </p>
                  </div>

                </div>

                <EvolutionChart
                data={simulationData.data}
                filters={filters}
                premiumPaid={filters.premiumPaid} />

              </> :

            <div className="bg-sky-50 text-center p-16 from-indigo-50 to-purple-50 rounded-xl border-2 border-dashed border-indigo-200">
                <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.5 }}>

                  <div className="bg-sky-100 mb-6 mx-auto w-20 h-20 rounded-full flex items-center justify-center">
                    <Activity className="w-10 h-10" style={{ color: '#68adf0' }} />
                  </div>
                  <h3 className="text-2xl font-bold text-slate-800 mb-3">
                    Select a contract or switch to Free Mode to simulate returns ⚡
                  </h3>
                  <p className="text-slate-600 max-w-md mx-auto">
                    Choose a ticker, option type, and contract from the filters on the left to visualize option value evolution and P&L projections. Or, switch to 'Free Mode' to manually enter parameters and simulate.
                  </p>
                </motion.div>
              </div>
            }
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="mt-8 text-center text-xs text-slate-500">

          <p className="mb-2">This simulator uses the Binomial Tree model for American-style options. Results account for early exercise opportunities.</p>
          <p className="italic">Disclaimer: These are theoretical projections based on the selected parameters and model assumptions. Actual market returns may differ significantly due to market conditions, volatility changes, liquidity constraints, bid-ask spreads, transaction costs, and other real-world factors not fully captured in this model. Past performance and theoretical projections are not indicative of future results.</p>
        </motion.div>
      </div>
    </div>);

}