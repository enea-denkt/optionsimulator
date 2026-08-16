import { useEffect, useMemo, useRef, useState } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { normalizeSymbol, searchSymbols } from "@/api/marketData";

export default function TickerSearch({ value, onSelect, disabled }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const requestId = useRef(0);

  const trimmedQuery = normalizeSymbol(query);

  // Debounced online lookup against the listed-symbol directory.
  useEffect(() => {
    if (!trimmedQuery) {
      setResults([]);
      setSearching(false);
      setError(null);
      return;
    }

    const id = ++requestId.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const matches = await searchSymbols(trimmedQuery);
        if (requestId.current !== id) return;
        setResults(matches);
        setError(null);
      } catch (err) {
        if (requestId.current !== id) return;
        console.error('Symbol search failed:', err);
        setResults([]);
        setError('Symbol directory unavailable — you can still type a ticker and pick “Use as typed”.');
      } finally {
        if (requestId.current === id) setSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [trimmedQuery]);

  const handleSelect = (symbol) => {
    setOpen(false);
    setQuery('');
    onSelect(normalizeSymbol(symbol));
  };

  // Let the user commit any ticker, even one missing from the directory — but
  // only when what they typed could plausibly be a ticker, not a company name.
  const showFreeEntry = useMemo(
    () =>
      /^[A-Z0-9.]{1,6}$/.test(trimmedQuery) && !results.some((r) => r.symbol === trimmedQuery),
    [trimmedQuery, results],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={`w-full justify-between text-base ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {value || "Search ticker..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        {/* Results are already ranked server-side; skip cmdk's own filtering. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Ticker or company name..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-72">
            {searching && (
              <div className="flex items-center gap-2 px-4 py-3 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching listed symbols...
              </div>
            )}

            {!searching && trimmedQuery && results.length === 0 && !error && (
              <CommandEmpty>No listed symbol matches “{trimmedQuery}”.</CommandEmpty>
            )}

            {error && <div className="px-4 py-3 text-xs text-amber-600">{error}</div>}

            {showFreeEntry && (
              <CommandGroup heading="Use as typed">
                <CommandItem value={`free-${trimmedQuery}`} onSelect={() => handleSelect(trimmedQuery)}>
                  <Search className="mr-2 h-4 w-4 opacity-60" />
                  <span className="font-medium">{trimmedQuery}</span>
                  <span className="ml-2 text-xs text-slate-500">load chain</span>
                </CommandItem>
              </CommandGroup>
            )}

            {results.length > 0 && (
              <CommandGroup heading="Listed symbols">
                {results.map((result) => (
                  <CommandItem key={result.symbol} value={result.symbol} onSelect={() => handleSelect(result.symbol)}>
                    <Check className={`mr-2 h-4 w-4 ${value === result.symbol ? 'opacity-100' : 'opacity-0'}`} />
                    <span className="font-medium">{result.symbol}</span>
                    <span className="ml-2 truncate text-xs text-slate-500">{result.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {!trimmedQuery && (
              <div className="px-4 py-6 text-center text-sm text-slate-500">
                Start typing a ticker or company name
                <span className="mt-1 block text-xs text-slate-400">
                  any US-listed symbol with options
                </span>
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
