import React from 'react';
import { ProductInsightData } from '../types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowDown, ArrowUp, ArrowUpDown, LayoutList } from 'lucide-react';

interface Props {
  data: ProductInsightData[];
  totalCount: number;
}

export const ProductTable: React.FC<Props> = ({ data, totalCount }) => {
  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(val);
  };

  const formatNumber = (val: number) => {
    return new Intl.NumberFormat('en-US').format(val);
  };

  const formatPercent = (val: number) => {
    return `${val.toFixed(2)}%`;
  };

  return (
    <Card className="border-0 shadow-none rounded-none mt-8">
      <CardHeader className="flex flex-row items-center justify-between pb-4 border-b border-border/50 px-0">
        <div className="flex items-center space-x-2">
          <LayoutList className="w-5 h-5 text-muted-foreground" />
          <CardTitle className="text-lg font-bold uppercase tracking-tight">Detailed Breakdown</CardTitle>
        </div>
        <Badge variant="outline" className="font-mono text-xs rounded-none border-primary/20 bg-primary/5 text-primary">
          Showing {data.length} of {totalCount} rows
        </Badge>
      </CardHeader>
      <CardContent className="p-0 pt-4">
        <div className="rounded-none border border-border overflow-hidden">
          <Table>
            <TableHeader className="bg-secondary/50">
              <TableRow className="hover:bg-transparent border-b border-border">
                <TableHead className="w-[300px] font-bold text-xs uppercase tracking-wide text-muted-foreground">Product</TableHead>
                <TableHead className="text-right font-bold text-xs uppercase tracking-wide text-muted-foreground">Spend</TableHead>
                <TableHead className="text-right font-bold text-xs uppercase tracking-wide text-muted-foreground">Impr.</TableHead>
                <TableHead className="text-right font-bold text-xs uppercase tracking-wide text-muted-foreground">Clicks</TableHead>
                <TableHead className="text-right font-bold text-xs uppercase tracking-wide text-muted-foreground">CTR</TableHead>
                <TableHead className="text-right font-bold text-xs uppercase tracking-wide text-muted-foreground">CPC</TableHead>
                <TableHead className="text-right font-bold text-xs uppercase tracking-wide text-muted-foreground">Purchases</TableHead>
                <TableHead className="text-right font-bold text-xs uppercase tracking-wide text-muted-foreground">CPA</TableHead>
                <TableHead className="text-right font-bold text-xs uppercase tracking-wide text-muted-foreground">ROAS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row, i) => (
                <TableRow key={i} className="hover:bg-muted/50 border-b border-border/50 transition-colors">
                  <TableCell className="font-medium">
                    <div className="flex flex-col">
                      <span className="text-sm text-foreground truncate max-w-[280px]" title={row.product_name}>
                        {row.product_name}
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground mt-1">
                        {row.product_retailer_id}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatCurrency(row.spend)}</TableCell>
                  <TableCell className="text-right font-mono text-sm text-muted-foreground">{formatNumber(row.impressions)}</TableCell>
                  <TableCell className="text-right font-mono text-sm text-muted-foreground">{formatNumber(row.clicks)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    <span className={row.ctr > 1 ? "text-emerald-600 font-bold" : "text-muted-foreground"}>
                      {formatPercent(row.ctr)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm text-muted-foreground">{formatCurrency(row.cpc)}</TableCell>
                  <TableCell className="text-right font-mono text-sm font-bold">{formatNumber(row.purchases)}</TableCell>
                  <TableCell className="text-right font-mono text-sm text-muted-foreground">
                    {row.purchases > 0 ? formatCurrency(row.spend / row.purchases) : '-'}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    <div className={`inline-flex items-center px-2 py-0.5 rounded-sm ${
                      row.purchase_roas >= 2 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 
                      row.purchase_roas >= 1 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : 
                      'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                    }`}>
                      {row.purchase_roas.toFixed(2)}x
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="h-24 text-center text-muted-foreground text-sm italic">
                    No data available for current filters
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};
