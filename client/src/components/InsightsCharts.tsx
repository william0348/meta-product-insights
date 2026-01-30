import React from 'react';
import { ProductInsightData } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { BarChart3 } from 'lucide-react';

interface Props {
  data: ProductInsightData[];
}

export const InsightsCharts: React.FC<Props> = ({ data }) => {
  // Sort by Spend descending and take top 10
  const topSpenders = [...data].sort((a, b) => b.spend - a.spend).slice(0, 10);
  
  // Sort by ROAS descending (min 100 spend) and take top 10
  const topRoas = [...data]
    .filter(x => x.spend > 100)
    .sort((a, b) => b.purchase_roas - a.purchase_roas)
    .slice(0, 10);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-popover border border-border p-3 shadow-lg rounded-none">
          <p className="text-xs font-bold uppercase text-muted-foreground mb-1">{label}</p>
          <p className="text-sm font-mono font-bold text-foreground">
            {payload[0].name}: {payload[0].name === 'Spend' ? '$' : ''}{payload[0].value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-8">
      <Card className="border-0 shadow-none rounded-none">
        <CardHeader className="pb-4 border-b border-border/50 px-0">
          <div className="flex items-center space-x-2">
            <BarChart3 className="w-5 h-5 text-muted-foreground" />
            <CardTitle className="text-lg font-bold uppercase tracking-tight">Top 10 Products by Spend</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0 pt-6">
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topSpenders} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" opacity={0.5} />
                <XAxis type="number" hide />
                <YAxis 
                  type="category" 
                  dataKey="product_name" 
                  width={150} 
                  tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} 
                  tickFormatter={(val) => val.length > 20 ? val.substring(0, 20) + '...' : val}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--muted)', opacity: 0.2 }} />
                <Bar dataKey="spend" name="Spend" radius={[0, 4, 4, 0]} barSize={20}>
                  {topSpenders.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill="var(--chart-1)" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-none rounded-none">
        <CardHeader className="pb-4 border-b border-border/50 px-0">
          <div className="flex items-center space-x-2">
            <BarChart3 className="w-5 h-5 text-muted-foreground" />
            <CardTitle className="text-lg font-bold uppercase tracking-tight">Top 10 ROAS (Spend &gt; $100)</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0 pt-6">
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topRoas} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" opacity={0.5} />
                <XAxis type="number" hide />
                <YAxis 
                  type="category" 
                  dataKey="product_name" 
                  width={150} 
                  tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                  tickFormatter={(val) => val.length > 20 ? val.substring(0, 20) + '...' : val}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--muted)', opacity: 0.2 }} />
                <Bar dataKey="purchase_roas" name="ROAS" radius={[0, 4, 4, 0]} barSize={20}>
                  {topRoas.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill="var(--chart-2)" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
