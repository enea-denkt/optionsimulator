
import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown, Loader2, RefreshCw, AlertCircle } from "lucide-react";
import { Switch } from "@/components/ui/switch"; // Import the Switch component
import TickerSearch from "./TickerSearch";
import { fetchOptionChain, findContractByOcc, formatExpiration, parseISODate, describeOccSymbol } from "@/api/marketData";

// Other series (SPXW, ...) share a strike and an expiration with the standard
// contract, so the root has to be in the label to tell them apart.
function contractLabel(strike, expiration, contract) {
  const base = `${strike} - ${formatExpiration(expiration)}`;
  return contract?.isStandardRoot === false ? `${base} (${contract.root})` : base;
}

/** Calendar days from today to an expiration, compared in local time both sides. */
function daysUntil(expiration) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((parseISODate(expiration) - today) / 86400000));
}


export default function OptionsFilters({ filters, onChange }) {
  const [contractOpen, setContractOpen] = useState(false);
  const [contractsData, setContractsData] = useState({});
  const [chainMeta, setChainMeta] = useState(null);   // quote time + underlying, for the freshness line
  const [loadingChain, setLoadingChain] = useState(false);
  const [chainError, setChainError] = useState(null);
  const [selectedQuote, setSelectedQuote] = useState(null);           // its live bid / ask / last
  const [contractQuery, setContractQuery] = useState('');


  // Local state for input fields to manage cursor position
  const [displayStockPrice, setDisplayStockPrice] = useState(filters.currentPrice.toFixed(2));
  const [displayPremiumPaid, setDisplayPremiumPaid] = useState(filters.premiumPaid.toFixed(2));
  const [displayEntryPremium, setDisplayEntryPremium] = useState(filters.entryPremium === null ? '' : filters.entryPremium.toFixed(2));
  const [displayStrikePrice, setDisplayStrikePrice] = useState(filters.strikePrice.toFixed(2));
  const [displayRiskFreeRate, setDisplayRiskFreeRate] = useState(filters.riskFreeRate.toFixed(2));


  // Effect to sync local display states with parent filter state when parent state changes
  useEffect(() => {
    setDisplayStockPrice(filters.currentPrice.toFixed(2));
  }, [filters.currentPrice]);

  useEffect(() => {
    setDisplayPremiumPaid(filters.premiumPaid.toFixed(2));
  }, [filters.premiumPaid]);

  useEffect(() => {
    setDisplayEntryPremium(filters.entryPremium === null ? '' : filters.entryPremium.toFixed(2));
  }, [filters.entryPremium]);

  useEffect(() => {
    setDisplayStrikePrice(filters.strikePrice.toFixed(2));
  }, [filters.strikePrice]);

  useEffect(() => {
    setDisplayRiskFreeRate(filters.riskFreeRate.toFixed(2));
  }, [filters.riskFreeRate]);


  // Loads the live chain for a ticker: underlying price, every listed contract,
  // its mark and its implied volatility. Data comes from Cboe's public
  // delayed-quotes feed, which needs no API key (see src/api/marketData.js).
  const loadChain = async (ticker, { force = false, preserveSelection = false } = {}) => {
    // Reset dependent fields first so stale numbers are never shown mid-load.
    // Skipped when restoring a shared link, where those fields are the point.
    if (!preserveSelection) {
      onChange({
        ...filters,
        ticker,
        currentPrice: 0,
        selectedContract: '',
        selectedOcc: '',
        premiumPaid: 0,
        strikePrice: 0,
        daysToExpiration: 90
      });
      setSelectedQuote(null);
    }

    setContractQuery('');
    setLoadingChain(true);
    setChainError(null);

    try {
      const chain = await fetchOptionChain(ticker, { force });

      setContractsData(chain.contracts);
      setChainMeta({
        quoteTime: chain.quoteTime,
        contractCount: chain.contractCount,
        iv30: chain.iv30
      });

      const next = {
        ...filters,
        ticker,
        currentPrice: chain.stockPrice,
        priceRangeMin: chain.stockPrice * 0.8,
        priceRangeMax: chain.stockPrice * 1.2
      };

      const restored = preserveSelection && filters.selectedOcc
        ? findContractByOcc(chain, filters.selectedOcc)
        : null;

      if (restored) {
        // A shared link carries only the contract's identity, so its price,
        // strike and expiry are re-read here — the reader sees today's quote.
        setSelectedQuote(restored);
        next.selectedContract = contractLabel(restored.strike, restored.expiration, restored);
        next.premiumPaid = restored.mark;
        next.strikePrice = restored.strike;
        next.daysToExpiration = daysUntil(restored.expiration);
        if (restored.implied_volatility) next.currentIV = Math.round(restored.implied_volatility * 100);
      } else if (!preserveSelection) {
        next.selectedContract = '';
        next.selectedOcc = '';
        next.premiumPaid = 0;
        next.strikePrice = 0;
        next.daysToExpiration = 90;
        next.currentIV = chain.iv30 ? Math.round(chain.iv30) : filters.currentIV;
      }

      onChange(next);
      setDisplayStockPrice(chain.stockPrice.toFixed(2));
    } catch (err) {
      console.error("Error fetching option chain:", err);
      setContractsData({});
      setChainMeta(null);
      setChainError(err.message || 'Could not load market data');
    } finally {
      setLoadingChain(false);
    }
  };

  const handleTickerChange = (ticker) => loadChain(ticker);

  // Restores a shared link: the URL supplies the ticker (and possibly a
  // contract) but not the chain, so fetch it once on mount without wiping the
  // very values that were shared.
  const restoredFor = useRef(null);
  useEffect(() => {
    if (!isTickerMode || !filters.ticker) return;
    if (restoredFor.current === filters.ticker) return;
    if (chainMeta || loadingChain) return;

    restoredFor.current = filters.ticker;
    loadChain(filters.ticker, { preserveSelection: true });
    // loadChain closes over filters; re-running on every change would refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.ticker, isTickerMode]);

  // Re-pull the chain and re-price whatever contract is currently selected.
  const handleRefreshQuotes = async () => {
    if (!filters.ticker) return;
    setLoadingChain(true);
    setChainError(null);

    try {
      const chain = await fetchOptionChain(filters.ticker, { force: true });
      setContractsData(chain.contracts);
      setChainMeta({
        quoteTime: chain.quoteTime,
        contractCount: chain.contractCount,
        iv30: chain.iv30
      });

      const next = {
        ...filters,
        currentPrice: chain.stockPrice,
        priceRangeMin: chain.stockPrice * 0.8,
        priceRangeMax: chain.stockPrice * 1.2
      };

      if (filters.selectedOcc) {
        // By OCC symbol, so a refresh re-prices the exact series that was
        // picked instead of whichever one happens to share its strike.
        const quote = findContractByOcc(chain, filters.selectedOcc);
        if (quote) {
          setSelectedQuote(quote);
          next.premiumPaid = quote.mark;
          if (quote.implied_volatility) next.currentIV = Math.round(quote.implied_volatility * 100);
        }
      }

      onChange(next);
      setDisplayStockPrice(chain.stockPrice.toFixed(2));
    } catch (err) {
      console.error("Error refreshing quotes:", err);
      setChainError(err.message || 'Could not refresh market data');
    } finally {
      setLoadingChain(false);
    }
  };




  // Takes an OCC symbol, not a "strike - expiration" string: that string is not
  // unique when a ticker has adjusted series, so it used to resolve to the first
  // matching contract rather than the one that was clicked.
  const handleContractChange = (occSymbol) => {
    const contract = availableContracts.find(c => c.occSymbol === occSymbol);
    if (!contract) return;

    setSelectedQuote(contract);

    // Close on pick, like the ticker search does, and clear the filter so the
    // list opens on the near-the-money contracts again next time.
    setContractOpen(false);
    setContractQuery('');

    onChange({
      ...filters,
      selectedContract: contract.label,
      selectedOcc: contract.occSymbol,
      premiumPaid: contract.premium,
      strikePrice: contract.strike,
      daysToExpiration: daysUntil(contract.expiration),
      currentIV: contract.iv !== null ? contract.iv : filters.currentIV // 👈 overwrite IV
    });
  };





  const handleOptionTypeChange = (type) => {
    setSelectedQuote(null);
    onChange({
      ...filters,
      optionType: type,
      selectedContract: '',
      selectedOcc: '',
      premiumPaid: 0,
      strikePrice: 0
    });
    // Reset local display state for premium and strike if option type changes
    setDisplayPremiumPaid(0.00.toFixed(2));
    setDisplayStrikePrice(0.00.toFixed(2));
  };

  // Update scenario based on expected price change
  const getScenarioFromPriceChange = (priceChange) => {
    if (priceChange > 5) return 'bullish';
    if (priceChange <= -5) return 'bearish';
    return 'neutral';
  };

  const handlePriceChangeUpdate = (value) => {
    const newScenario = getScenarioFromPriceChange(value);
    onChange({
      ...filters,
      expectedPriceChange: value,
      scenario: newScenario
    });
  };

  const handleScenarioClick = (scenario) => {
    const newFilters = { ...filters, scenario };
    if (scenario === 'bullish') {
      newFilters.expectedPriceChange = 50;
    } else if (scenario === 'bearish') {
      newFilters.expectedPriceChange = -30;
    } else {
      newFilters.expectedPriceChange = 5; // Updated from 10 to 5
    }
    onChange(newFilters);
  };

  const scenarioOptions = [
    { value: 'bullish', label: 'Bullish', icon: TrendingUp, color: 'text-emerald-500', preset: '+50%' },
    { value: 'neutral', label: 'Neutral', icon: Minus, color: 'text-slate-500', preset: '+5%' }, // Updated from '+10%' to '+5%'
    { value: 'bearish', label: 'Bearish', icon: TrendingDown, color: 'text-rose-500', preset: '-30%' }
  ];

  // Calculate resulting values
  const resultingPrice = filters.currentPrice * (1 + filters.expectedPriceChange / 100);
  const resultingIV = filters.currentIV * (1 + filters.expectedIVChange / 100);

  const getAvailableContracts = () => {
    if (!filters.optionType || !contractsData[filters.optionType]) return [];

    return Object.entries(contractsData[filters.optionType])
      .flatMap(([strike, contracts]) =>
        contracts.map((c) => ({
          // Other series (SPXW, ASST1, ...) share a strike and an expiration with
          // the standard contract, so the root has to be in the label to tell
          // them apart.
          label: contractLabel(strike, c.expiration, c),
          occSymbol: c.occSymbol,                               // unique identity
          root: c.root,
          isStandardRoot: c.isStandardRoot,
          strike: parseFloat(strike),
          expiration: c.expiration,
          premium: parseFloat(c.mark) || 0,                     // mid of bid/ask, else last trade
          iv: c.implied_volatility
            ? Math.round(parseFloat(c.implied_volatility) * 100) // → % with 0 decimals
            : null,
          bid: c.bid,
          ask: c.ask,
          last: c.last,
          volume: c.volume,
          openInterest: c.openInterest
        }))
      )
      // Nearest expiration first, then by strike — the order traders scan in.
      .sort(
        (a, b) =>
          a.expiration.localeCompare(b.expiration) ||
          a.strike - b.strike ||
          Number(b.isStandardRoot) - Number(a.isStandardRoot)
      );
  };




  const availableContracts = getAvailableContracts();
  const isTickerMode = filters.simulationMode === 'ticker';

  // With no search term, lead with the strikes closest to spot — the ones anyone
  // actually trades — instead of the far wings that dominate a raw chain.
  const CONTRACT_RENDER_LIMIT = 150;
  const matchedContracts = (() => {
    const query = contractQuery.trim().toLowerCase();
    if (!query) {
      const spot = filters.currentPrice;
      return [...availableContracts].sort(
        (a, b) =>
          a.expiration.localeCompare(b.expiration) ||
          Math.abs(a.strike - spot) - Math.abs(b.strike - spot) ||
          Number(b.isStandardRoot) - Number(a.isStandardRoot)
      );
    }
    return availableContracts.filter(
      (c) =>
        c.label.toLowerCase().includes(query) ||
        c.occSymbol.toLowerCase().includes(query)
    );
  })();

  const visibleContracts = matchedContracts.slice(0, CONTRACT_RENDER_LIMIT);
  const hiddenContractCount = matchedContracts.length - visibleContracts.length;

  return (
    <Card className="border-slate-200 shadow-xl">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
        <CardTitle className="text-xl font-semibold text-slate-900">
          Simulation Parameters
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        {/* Simulation Mode Switch */}
        <div className="space-y-3 pb-6 border-b border-slate-200">
          <div className="flex items-center justify-between">
            <Label htmlFor="simulation-mode" className="text-sm font-medium text-slate-700">
              {isTickerMode ? 'Ticker-linked Simulation' : 'Freeform Simulation'}
            </Label>
            <Switch
              id="simulation-mode"
              checked={!isTickerMode}
              onCheckedChange={(checked) => onChange({ ...filters, simulationMode: checked ? 'free' : 'ticker' })}
            />
          </div>
          <p className="text-xs text-slate-500 italic">
            {isTickerMode ? 'Select existing options contracts and parameters will auto-fill.' : 'Customize all parameters freely without real-world contract data.'}
          </p>
        </div>

        {/* 1. Ticker */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium text-slate-700">
              Ticker
            </Label>
            {isTickerMode && filters.ticker && (
              <button
                type="button"
                onClick={handleRefreshQuotes}
                disabled={loadingChain}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50"
                title="Reload live prices"
              >
                <RefreshCw className={`h-3 w-3 ${loadingChain ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            )}
          </div>

          <TickerSearch
            value={filters.ticker}
            onSelect={handleTickerChange}
            disabled={!isTickerMode}
          />

          {isTickerMode && loadingChain && (
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading live option chain...
            </p>
          )}

          {isTickerMode && chainError && (
            <p className="flex items-start gap-2 text-xs text-rose-600">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              {chainError}
            </p>
          )}

          {isTickerMode && !loadingChain && !chainError && chainMeta && (
            <p className="text-xs text-slate-500 italic">
              {chainMeta.contractCount.toLocaleString()} contracts · quotes as of {chainMeta.quoteTime} (delayed)
            </p>
          )}
        </div>

        {/* 2. Current Stock Price */}
        <div className="space-y-3">
          <Label htmlFor="stockPrice" className="text-sm font-medium text-slate-700">
            Current Stock Price ($)
          </Label>
          <Input
            id="stockPrice"
            type="text"
            value={displayStockPrice}
            onChange={(e) => setDisplayStockPrice(e.target.value.replace(',', '.'))}
            onBlur={() => {
              const parsedValue = parseFloat(displayStockPrice) || 0;
              onChange({ ...filters, currentPrice: parsedValue });
              setDisplayStockPrice(parsedValue.toFixed(2)); // Re-format on blur
            }}
            onFocus={(e) => {
              e.target.select();
            }}
            className={`text-lg font-semibold ${isTickerMode ? 'opacity-50 cursor-not-allowed' : ''}`}
            disabled={isTickerMode}
          />
        </div>

        {/* 3. Option Type */}
        <div className="space-y-3">
          <Label className="text-sm font-medium text-slate-700">
            Option Type
          </Label>
          <Select
            value={filters.optionType}
            onValueChange={handleOptionTypeChange}
          >
            <SelectTrigger className="text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="call">Call Option</SelectItem>
              <SelectItem value="put">Put Option</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 4. Contract */}
        <div className="space-y-3">
          <Label className="text-sm font-medium text-slate-700">
            Contract (Strike - Expiration)
          </Label>
          <Popover open={contractOpen} onOpenChange={setContractOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={contractOpen}
                className={`w-full justify-between text-base ${!isTickerMode || !filters.ticker ? 'opacity-50 cursor-not-allowed' : ''}`}
                disabled={!filters.ticker || !isTickerMode}
              >
                {filters.selectedContract
                  || describeOccSymbol(filters.selectedOcc)?.label
                  || "Select contract..."}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            {isTickerMode && filters.ticker && (
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                {/* A full chain is a few thousand rows, so filtering and capping is
                    done here rather than letting cmdk walk every item on each keystroke. */}
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Search strike or expiration..."
                    value={contractQuery}
                    onValueChange={setContractQuery}
                  />
                  <CommandList className="max-h-72">
                    {visibleContracts.length === 0 && <CommandEmpty>No contract found.</CommandEmpty>}
                    <CommandGroup>
                      {visibleContracts.map((contract) => (
                        <CommandItem
                          key={contract.occSymbol}
                          value={contract.occSymbol}
                          onSelect={() => handleContractChange(contract.occSymbol)}
                        >
                          <Check
                            className={`mr-2 h-4 w-4 ${
                              filters.selectedOcc === contract.occSymbol
                                ? "opacity-100"
                                : "opacity-0"
                            }`}
                          />
                          <div className="flex justify-between w-full gap-2">
                            <span className="whitespace-nowrap">{contract.label}</span>
                            <span className="text-slate-500 whitespace-nowrap">
                              ${contract.premium.toFixed(2)}
                              {contract.iv !== null && (
                                <span className="ml-2 text-slate-400">{contract.iv}% IV</span>
                              )}
                            </span>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                    {hiddenContractCount > 0 && (
                      <p className="px-3 py-2 text-xs text-slate-500 border-t border-slate-100">
                        +{hiddenContractCount.toLocaleString()} more — type a strike or month to narrow down
                      </p>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>

            )}
          </Popover>
        </div>

        {/* 5. Strike Price - only in free mode */}
        {!isTickerMode && (
          <div className="space-y-3">
            <Label htmlFor="strikePrice" className="text-sm font-medium text-slate-700">
              Strike Price ($)
            </Label>
            <Input
              id="strikePrice"
              type="text"
              value={displayStrikePrice}
              onChange={(e) => setDisplayStrikePrice(e.target.value.replace(',', '.'))}
              onBlur={() => {
                const parsedValue = parseFloat(displayStrikePrice) || 0;
                onChange({ ...filters, strikePrice: parsedValue });
                setDisplayStrikePrice(parsedValue.toFixed(2));
              }}
              onFocus={(e) => {
                e.target.select();
              }}
              className="text-lg font-semibold"
            />
          </div>
        )}

        {/* 6. Current Premium */}
        <div className="space-y-3">
          <Label htmlFor="premium" className="text-sm font-medium text-slate-700">
            Current Premium ($)
          </Label>
          <Input
            id="premium"
            type="text"
            value={displayPremiumPaid}
            onChange={(e) => setDisplayPremiumPaid(e.target.value.replace(',', '.'))}
            onBlur={() => {
              const parsedValue = parseFloat(displayPremiumPaid) || 0;
              onChange({ ...filters, premiumPaid: parsedValue });
              setDisplayPremiumPaid(parsedValue.toFixed(2)); // Re-format on blur
            }}
            onFocus={(e) => {
              e.target.select();
            }}
            className={`text-lg font-semibold ${isTickerMode ? 'opacity-50 cursor-not-allowed' : ''}`}
            disabled={isTickerMode}
          />
          {isTickerMode && selectedQuote ? (
            <div className="text-xs text-slate-500 space-y-1">
              <p className="italic">
                Mid of bid/ask on the live chain
                {selectedQuote.occSymbol && (
                  <span className="ml-1 not-italic text-slate-400">· {selectedQuote.occSymbol}</span>
                )}
              </p>
              <p className="flex flex-wrap gap-x-3 gap-y-1 font-medium text-slate-600">
                <span>Bid ${Number(selectedQuote.bid || 0).toFixed(2)}</span>
                <span>Ask ${Number(selectedQuote.ask || 0).toFixed(2)}</span>
                <span>Last ${Number(selectedQuote.last || 0).toFixed(2)}</span>
              </p>
              <p>
                Vol {Number(selectedQuote.volume || 0).toLocaleString()} · OI{' '}
                {Number(selectedQuote.openInterest || 0).toLocaleString()}
              </p>
            </div>
          ) : isTickerMode && (
            <p className="text-xs text-slate-500 italic">
              Auto-filled from selected contract
            </p>
          )}
        </div>

        {/* Entry Premium */}
        <div className="space-y-3">
          <Label htmlFor="entryPremium" className="text-sm font-medium text-slate-700">
            Entry Premium ($)
          </Label>
          <Input
            id="entryPremium"
            type="text"
            value={displayEntryPremium}
            onChange={(e) => setDisplayEntryPremium(e.target.value.replace(',', '.'))}
            onBlur={() => {
              const value = displayEntryPremium.replace(',', '.');
              const parsedValue = value === '' ? null : parseFloat(value);
              onChange({ ...filters, entryPremium: parsedValue });
              setDisplayEntryPremium(parsedValue === null ? '' : parsedValue.toFixed(2)); // Re-format on blur
            }}
            onFocus={(e) => {
                e.target.select();
            }}
            placeholder="Optional"
            className="text-lg font-semibold"
          />
          <p className="text-xs text-slate-500 italic">
            Optional: Use to visualize profit/loss threshold
          </p>
        </div>

        {/* Days to Expiration */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="daysToExpiration" className="text-sm font-medium text-slate-700">
              Days to Expiration
            </Label>
            <div className="text-right">
              <div className="text-sm font-semibold" style={{ color: '#2188e6' }}>{filters.daysToExpiration}</div>
              <div className="text-xs text-slate-500">
                → {(() => {
                  const today = new Date();
                  const expDate = new Date(today);
                  expDate.setDate(expDate.getDate() + filters.daysToExpiration);
                  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                  const month = months[expDate.getMonth()];
                  const day = expDate.getDate();
                  const year = expDate.getFullYear().toString().slice(-2); // Get last two digits of the year
                  return `${month} ${day}, '${year}`; // Added apostrophe for 2-digit year
                })()}
              </div>
            </div>
          </div>
          <Slider
            id="daysToExpiration"
            value={[filters.daysToExpiration]}
            onValueChange={(value) => {
              onChange({ ...filters, daysToExpiration: value[0] });
            }}
            min={1}
            max={1095}
            step={1}
            className={`mt-2 ${isTickerMode ? 'opacity-50 pointer-events-none' : ''}`}
            disabled={isTickerMode}
          />
          <div className="flex justify-between text-xs text-slate-500">
            <span>1 day</span>
            <span>1095 days (3 years)</span>
          </div>
          {isTickerMode && (
            <p className="text-xs text-slate-500 italic">
              Auto-filled from selected contract
            </p>
          )}
        </div>

        {/* Market Scenario Presets */}
        <div className="space-y-3">
          <Label className="text-sm font-medium text-slate-700">
            Quick Scenario Presets
          </Label>
          <div className="grid grid-cols-3 gap-2">
            {scenarioOptions.map((scenario) => (
              <button
                key={scenario.value}
                onClick={() => handleScenarioClick(scenario.value)}
                className={`p-3 rounded-lg border-2 transition-all ${
                  filters.scenario === scenario.value
                    ? 'bg-blue-50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
                style={filters.scenario === scenario.value ? { borderColor: '#2188e6' } : {}}
              >
                <scenario.icon className={`w-5 h-5 mx-auto mb-1 ${scenario.color}`} />
                <span className="text-xs font-medium text-slate-700 block">{scenario.label}</span>
                <span className="text-xs text-slate-500">{scenario.preset}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500 italic">Automatically updates based on expected price change</p>
        </div>

        {/* Expected Price Change */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="priceChange" className="text-sm font-medium text-slate-700">
              Expected Stock Price Change
            </Label>
            <div className="text-right">
              <div className="text-sm font-semibold" style={{ color: '#2188e6' }}>{filters.expectedPriceChange}%</div>
              <div className="text-xs text-slate-500">→ ${resultingPrice.toFixed(2)}</div>
            </div>
          </div>
          <Slider
            id="priceChange"
            value={[filters.expectedPriceChange]}
            onValueChange={(value) => handlePriceChangeUpdate(value[0])}
            min={-100}
            max={600}
            step={1}
            className="mt-2"
          />
          <div className="flex justify-between text-xs text-slate-500">
            <span>-100%</span>
            <span>+600%</span>
          </div>
        </div>

        {/* Current IV */}
        <div className="space-y-3">
          <Label htmlFor="currentIV" className="text-sm font-medium text-slate-700">
            Current Implied Volatility: <span className="font-semibold" style={{ color: '#2188e6' }}>{filters.currentIV}%</span>
          </Label>
          <Slider
            id="currentIV"
            value={[filters.currentIV]}
            onValueChange={(value) => onChange({ ...filters, currentIV: value[0] })}
            min={10}
            max={300}
            step={1}   // 👈 was 5, now 1
            className={`mt-2 ${isTickerMode ? 'opacity-50 pointer-events-none' : ''}`}
            disabled={isTickerMode}
          />

          <div className="flex justify-between text-xs text-slate-500">
            <span>10%</span>
            <span>300%</span>
          </div>
          {isTickerMode && (
            <p className="text-xs text-slate-500 italic">
              Auto-filled from market data
            </p>
          )}
        </div>

        {/* Expected IV Change */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="ivChange" className="text-sm font-medium text-slate-700">
              Expected IV Change
            </Label>
            <div className="text-right">
              <div className="text-sm font-semibold" style={{ color: '#2188e6' }}>{filters.expectedIVChange}%</div>
              <div className="text-xs text-slate-500">→ {resultingIV.toFixed(1)}% IV</div>
            </div>
          </div>
          <Slider
            id="ivChange"
            value={[filters.expectedIVChange]}
            onValueChange={(value) => onChange({ ...filters, expectedIVChange: value[0] })}
            min={-100}
            max={600}
            step={1}
            className="mt-2"
          />
          <div className="flex justify-between text-xs text-slate-500">
            <span>-100%</span>
            <span>+600%</span>
          </div>
        </div>

        {/* Risk-free Rate */}
        <div className="space-y-3">
          <Label htmlFor="riskFreeRate" className="text-sm font-medium text-slate-700">
            Risk-free Rate (%)
          </Label>
          <Input
              id="riskFreeRate"
              type="text"
              value={displayRiskFreeRate}
              onChange={(e) => setDisplayRiskFreeRate(e.target.value.replace(",", "."))}
              onBlur={() => {
                const parsedValue = parseFloat(displayRiskFreeRate) || 0;
                onChange({ ...filters, riskFreeRate: parsedValue });
                setDisplayRiskFreeRate(parsedValue.toFixed(2)); // force format back
              }}
              onFocus={(e) => e.target.select()}
              className="text-base font-semibold"
            />

        </div>
      </CardContent>
    </Card>
  );
}