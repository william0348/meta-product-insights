import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { ReportConfig } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Play, Settings2 } from 'lucide-react';

const formSchema = z.object({
  accessToken: z.string().min(1, 'Access Token is required'),
  accountId: z.string().min(1, 'Account ID is required'),
  dateStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format: YYYY-MM-DD'),
  dateEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format: YYYY-MM-DD'),
  level: z.string(),
  breakdown: z.string(),
  minSpend: z.string().optional(),
  minCTR: z.string().optional()
});

interface Props {
  onSubmit: (data: ReportConfig) => void;
  isProcessing: boolean;
  defaultToken?: string;
  defaultAccountId?: string;
}

export const ReportConfigForm: React.FC<Props> = ({ onSubmit, isProcessing, defaultToken, defaultAccountId }) => {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      accessToken: defaultToken || '',
      accountId: defaultAccountId || '',
      // Set default start date to 60 days ago
      dateStart: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      dateEnd: new Date().toISOString().split('T')[0],
      level: 'account',
      breakdown: 'product_id',
      minSpend: '',
      minCTR: ''
    }
  });

  // Update form when props change (tokens loaded from database)
  useEffect(() => {
    if (defaultToken) {
      form.setValue('accessToken', defaultToken);
    }
  }, [defaultToken, form]);

  useEffect(() => {
    if (defaultAccountId) {
      form.setValue('accountId', defaultAccountId);
    }
  }, [defaultAccountId, form]);

  return (
    <Card className="border-0 shadow-none bg-secondary/30 rounded-none">
      <CardHeader className="pb-4 border-b border-border/50">
        <div className="flex items-center space-x-2">
          <Settings2 className="w-5 h-5 text-muted-foreground" />
          <CardTitle className="text-lg font-bold uppercase tracking-tight">Configuration</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <FormField
              control={form.control}
              name="accessToken"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Access Token</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="EAAA..." 
                      {...field} 
                      type="password"
                      className="font-mono text-xs bg-background border-border focus:border-primary focus:ring-0 rounded-none h-10"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="accountId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Ad Account ID</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                        <span className="text-muted-foreground font-mono text-xs">act_</span>
                      </div>
                      <Input 
                        placeholder="123456789" 
                        {...field} 
                        onChange={(e) => {
                          // Strip act_ prefix if user pastes it
                          const val = e.target.value.replace(/^act_/, '');
                          // Only allow numeric input
                          if (/^\d*$/.test(val)) {
                            field.onChange(val);
                          }
                        }}
                        className="font-mono text-xs bg-background border-border focus:border-primary focus:ring-0 rounded-none h-10 pl-10"
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="dateStart"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Start Date</FormLabel>
                    <FormControl>
                      <Input 
                        type="date" 
                        {...field} 
                        className="font-mono text-xs bg-background border-border focus:border-primary focus:ring-0 rounded-none h-10"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="dateEnd"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-bold uppercase tracking-wide text-muted-foreground">End Date</FormLabel>
                    <FormControl>
                      <Input 
                        type="date" 
                        {...field} 
                        className="font-mono text-xs bg-background border-border focus:border-primary focus:ring-0 rounded-none h-10"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="level"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Level</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="bg-background border-border focus:border-primary focus:ring-0 rounded-none h-10 text-xs font-medium">
                          <SelectValue placeholder="Select level" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="rounded-none border-border">
                        <SelectItem value="account">Account</SelectItem>
                        <SelectItem value="campaign">Campaign</SelectItem>
                        <SelectItem value="adset">Ad Set</SelectItem>
                        <SelectItem value="ad">Ad</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="breakdown"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Breakdown</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="bg-background border-border focus:border-primary focus:ring-0 rounded-none h-10 text-xs font-medium">
                          <SelectValue placeholder="Select breakdown" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="rounded-none border-border">
                        <SelectItem value="product_id">Product ID</SelectItem>
                        <SelectItem value="impression_device">Device</SelectItem>
                        <SelectItem value="publisher_platform">Platform</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* API-Level Filters Section */}
            <div className="border-t border-border/50 pt-5 mt-2">
              <div className="mb-3">
                <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">API Filters (Optional)</h4>
                <p className="text-[10px] text-muted-foreground/70">Filter data at source to reduce file size</p>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="minSpend"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Min Spend ($)</FormLabel>
                      <FormControl>
                        <Input 
                          type="number"
                          step="0.01"
                          placeholder="e.g., 100" 
                          {...field} 
                          className="font-mono text-xs bg-background border-border focus:border-primary focus:ring-0 rounded-none h-10"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="minCTR"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Min CTR (%)</FormLabel>
                      <FormControl>
                        <Input 
                          type="number"
                          step="0.01"
                          placeholder="e.g., 1.5" 
                          {...field} 
                          className="font-mono text-xs bg-background border-border focus:border-primary focus:ring-0 rounded-none h-10"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <Button 
              type="submit" 
              disabled={isProcessing} 
              className="w-full rounded-none h-12 text-sm font-bold uppercase tracking-wide bg-primary hover:bg-primary/90 text-primary-foreground transition-all active:scale-[0.98]"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing Request
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4 fill-current" />
                  Generate Report
                </>
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
};
