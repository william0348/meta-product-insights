import React, { useState } from 'react';
import { FilterCondition } from '../types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, X, Filter } from 'lucide-react';
import { nanoid } from 'nanoid';

interface Props {
  activeFilters: FilterCondition[];
  onFiltersChange: (filters: FilterCondition[]) => void;
}

export const FilterBar: React.FC<Props> = ({ activeFilters, onFiltersChange }) => {
  const [newFilterField, setNewFilterField] = useState('spend');
  const [newFilterOperator, setNewFilterOperator] = useState<any>('>');
  const [newFilterValue, setNewFilterValue] = useState('0');

  const handleAddFilter = () => {
    const val = parseFloat(newFilterValue);
    if (isNaN(val)) return;

    const newFilter: FilterCondition = {
      id: nanoid(),
      field: newFilterField,
      operator: newFilterOperator,
      value: val
    };

    onFiltersChange([...activeFilters, newFilter]);
  };

  const removeFilter = (id: string) => {
    onFiltersChange(activeFilters.filter(f => f.id !== id));
  };

  const getFieldLabel = (field: string) => {
    const map: Record<string, string> = {
      spend: 'Spend',
      impressions: 'Impressions',
      link_clicks: 'Link Clicks',
      ctr: 'CTR',
      cvr: 'CVR',
      cpc: 'CPC',
      purchases: 'Ad Purchases',
      catalog_purchases: 'Catalog Purchases',
      purchase_roas: 'ROAS'
    };
    return map[field] || field;
  };

  return (
    <div className="bg-secondary/30 p-4 border-y border-border/50 mb-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        
        {/* Active Filters List */}
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="flex items-center text-xs font-bold uppercase tracking-wide text-muted-foreground mr-2">
            <Filter className="w-3 h-3 mr-1" />
            Filters:
          </div>
          
          {activeFilters.length === 0 && (
            <span className="text-xs text-muted-foreground italic">No active filters</span>
          )}

          {activeFilters.map(filter => (
            <Badge key={filter.id} variant="secondary" className="rounded-none border border-border bg-background px-2 py-1 h-7 flex items-center gap-1 text-xs font-mono">
              <span className="font-bold text-primary">{getFieldLabel(filter.field)}</span>
              <span className="text-muted-foreground mx-1">{filter.operator}</span>
              <span>{filter.value}</span>
              <button onClick={() => removeFilter(filter.id)} className="ml-1 hover:text-destructive transition-colors">
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>

        {/* Add New Filter */}
        <div className="flex items-center gap-2 bg-background p-1 border border-border w-full md:w-auto">
          <Select value={newFilterField} onValueChange={setNewFilterField}>
            <SelectTrigger className="w-[140px] h-8 text-xs border-0 focus:ring-0 rounded-none bg-transparent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none">
              <SelectItem value="spend">Spend</SelectItem>
              <SelectItem value="impressions">Impressions</SelectItem>
              <SelectItem value="link_clicks">Link Clicks</SelectItem>
              <SelectItem value="ctr">CTR (%)</SelectItem>
              <SelectItem value="cvr">CVR (%)</SelectItem>
              <SelectItem value="cpc">CPC</SelectItem>
              <SelectItem value="purchases">Ad Purchases</SelectItem>
              <SelectItem value="catalog_purchases">Catalog Purchases</SelectItem>
              <SelectItem value="purchase_roas">ROAS</SelectItem>
            </SelectContent>
          </Select>

          <Select value={newFilterOperator} onValueChange={setNewFilterOperator}>
            <SelectTrigger className="w-[60px] h-8 text-xs font-mono border-0 focus:ring-0 rounded-none bg-muted/30">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none">
              <SelectItem value=">">&gt;</SelectItem>
              <SelectItem value="<">&lt;</SelectItem>
              <SelectItem value=">=">&ge;</SelectItem>
              <SelectItem value="<=">&le;</SelectItem>
              <SelectItem value="=">=</SelectItem>
            </SelectContent>
          </Select>

          <Input 
            type="number" 
            value={newFilterValue}
            onChange={(e) => setNewFilterValue(e.target.value)}
            className="w-[80px] h-8 text-xs font-mono border-0 focus:ring-0 rounded-none bg-transparent text-right"
            placeholder="0"
          />

          <Button onClick={handleAddFilter} size="sm" variant="ghost" className="h-8 w-8 p-0 rounded-none hover:bg-primary hover:text-primary-foreground">
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};
