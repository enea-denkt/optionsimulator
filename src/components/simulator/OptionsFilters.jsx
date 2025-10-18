
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown } from "lucide-react";
import { Switch } from "@/components/ui/switch"; // Import the Switch component



export default function OptionsFilters({ filters, onChange }) {
  const [contractOpen, setContractOpen] = useState(false);
  const [contractsData, setContractsData] = useState({});


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


  const handleTickerChange = async (ticker) => {
      // Reset filters first
      onChange({
        ...filters,
        ticker,
        currentPrice: 0,
        selectedContract: '',
        premiumPaid: 0,
        strikePrice: 0,
        daysToExpiration: 90
      });

      try {
        const res = await fetch(`/member/fetch_available_contracts_and_prices.php?symbol=${ticker}`);
        const data = await res.json();

        if (data && data[ticker]) {
          setContractsData(data[ticker].contracts || {});
          const stockPrice = data[ticker].stock_price || 0;

          // Update filters with stock price
          onChange({
            ...filters,
            ticker,
            currentPrice: stockPrice,
            selectedContract: '',
            premiumPaid: 0,
            strikePrice: 0,
            daysToExpiration: 90,
            priceRangeMin: stockPrice * 0.8,
            priceRangeMax: stockPrice * 1.2
          });

          setDisplayStockPrice(stockPrice.toFixed(2));
        }
      } catch (err) {
        console.error("Error fetching contracts and stock price:", err);
        setContractsData({});
      }
    };




  const handleContractChange = (contractString) => {
    const [strike, expDate] = contractString.split(" - ");
    
    if (!contractsData[filters.optionType]) return;

    const expirations = contractsData[filters.optionType][strike];
    if (!expirations) return;

    const expirationDate = expDate;
    const today = new Date();
    const todayDate = new Date(today.toISOString().split('T')[0]);
    const expirationDateObj = new Date(expirationDate);

    const diffTime = expirationDateObj - todayDate;
    const daysToExp = Math.max(1, Math.round(diffTime / (1000 * 60 * 60 * 24)));

    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const month = months[expirationDateObj.getMonth()];
    const day = expirationDateObj.getDate();
    const year = expirationDateObj.getFullYear().toString().slice(-2);
    const formattedContractString = `${strike} - ${month} ${day}, '${year}`;

    const contract = availableContracts.find(c => c.value === contractString);

    const newFilters = {
      ...filters,
      selectedContract: formattedContractString,
      premiumPaid: contract ? contract.premium : 0,
      strikePrice: parseFloat(strike),
      daysToExpiration: daysToExp,
      currentIV: contract && contract.iv !== null ? contract.iv : filters.currentIV // 👈 overwrite IV
    };

    onChange(newFilters);
  };





  const handleOptionTypeChange = (type) => {
    onChange({
      ...filters,
      optionType: type,
      selectedContract: '',
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
        contracts.map(({ expiration, mark, implied_volatility }) => {
          const exp = new Date(expiration);
          const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          const formatted = `${months[exp.getMonth()]} ${exp.getDate()}, '${exp.getFullYear().toString().slice(-2)}`;
          return {
            label: `${strike} - ${formatted}`,       // display
            value: `${strike} - ${expiration}`,      // internal value
            premium: parseFloat(mark) || 0,          // premium
            iv: implied_volatility
              ? Math.round(parseFloat(implied_volatility) * 100) // → % with 0 decimals
              : null
          };
        })
      );
  };




  const availableContracts = getAvailableContracts();
  const isTickerMode = filters.simulationMode === 'ticker';

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
          <Label className="text-sm font-medium text-slate-700">
            Ticker
          </Label>
          <Select
            value={filters.ticker}
            onValueChange={handleTickerChange}
            disabled={!isTickerMode}
          >
            <SelectTrigger className={`text-base ${!isTickerMode ? 'opacity-50 cursor-not-allowed' : ''}`}>
              <SelectValue placeholder="Select ticker..." />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>BTC Treasuries</SelectLabel>
                {["ASST","CEP","COIN","GME","KULR","MSTR","NAKA","SMLR","SQNS","TSLA"].map((ticker) => (
                  <SelectItem key={ticker} value={ticker}>{ticker}</SelectItem>
                ))}
              </SelectGroup>

              <SelectGroup>
                <SelectLabel>BTC Miners</SelectLabel>
                {['ABTC','BITF','BTDR','CIFR','CLSK','GLXY','HIVE','HUT','IREN','MARA','RIOT'].map((ticker) => (
                  <SelectItem key={ticker} value={ticker}>{ticker}</SelectItem>
                ))}
              </SelectGroup>

              <SelectGroup>
                <SelectLabel>Preferred Stocks</SelectLabel>
                {["STRC","STRD","STRF"].map((ticker) => (
                  <SelectItem key={ticker} value={ticker}>{ticker}</SelectItem>
                ))}
              </SelectGroup>

              <SelectGroup>
                <SelectLabel>ETFs & ETPs</SelectLabel>
                {["IBIT","MSTY"].map((ticker) => (
                  <SelectItem key={ticker} value={ticker}>{ticker}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

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
                {filters.selectedContract || "Select contract..."}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            {isTickerMode && filters.ticker && (
              <PopoverContent className="w-full p-0">
                <Command
                  // Override default fuzzy search
                  filter={(value, search) => {
                    return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
                  }}
                >
                  <CommandInput placeholder="Search contracts..." />
                  <CommandEmpty>No contract found.</CommandEmpty>
                  <CommandGroup className="max-h-64 overflow-auto">
                    {availableContracts.map((contract) => (
                      <CommandItem
                        key={contract.value}
                        value={contract.label}   // 👈 important: use .label here for search
                        onSelect={() => handleContractChange(contract.value)}
                      >
                        <Check
                          className={`mr-2 h-4 w-4 ${
                            filters.selectedContract === contract.label
                              ? "opacity-100"
                              : "opacity-0"
                          }`}
                        />
                        <div className="flex justify-between w-full">
                          <span>{contract.label}</span>
                          <span className="text-slate-500 ml-2">${contract.premium}</span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
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
          {isTickerMode && (
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
            max={730}
            step={1}
            className={`mt-2 ${isTickerMode ? 'opacity-50 pointer-events-none' : ''}`}
            disabled={isTickerMode}
          />
          <div className="flex justify-between text-xs text-slate-500">
            <span>1 day</span>
            <span>730 days (2 years)</span>
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