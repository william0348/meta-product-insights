import React, { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { ArrowLeft, Save, Trash2, Key, ShoppingBag, Loader2, Eye, EyeOff, Filter } from 'lucide-react';

export default function Settings() {
  const [, setLocation] = useLocation();
  
  // Token state
  const [adsToken, setAdsToken] = useState('');
  const [adsAccountId, setAdsAccountId] = useState('');
  const [catalogToken, setCatalogToken] = useState('');
  const [catalogId, setCatalogId] = useState('');
  
  // Filter preferences state
  const [minSpend, setMinSpend] = useState('');
  const [minCTR, setMinCTR] = useState('');
  
  // UI state
  const [showAdsToken, setShowAdsToken] = useState(false);
  const [showCatalogToken, setShowCatalogToken] = useState(false);
  const [isSavingAds, setIsSavingAds] = useState(false);
  const [isSavingCatalog, setIsSavingCatalog] = useState(false);
  const [isSavingFilters, setIsSavingFilters] = useState(false);
  const [isDeletingAds, setIsDeletingAds] = useState(false);
  const [isDeletingCatalog, setIsDeletingCatalog] = useState(false);
  const [isDeletingFilters, setIsDeletingFilters] = useState(false);
  
  // tRPC hooks
  const saveTokenMutation = trpc.tokens.save.useMutation();
  const deleteTokenMutation = trpc.tokens.delete.useMutation();
  
  const { data: adsTokenData, refetch: refetchAdsToken } = trpc.tokens.get.useQuery(
    { tokenType: "ads_management" },
    { refetchOnWindowFocus: false }
  );
  
  const { data: catalogTokenData, refetch: refetchCatalogToken } = trpc.tokens.get.useQuery(
    { tokenType: "catalog_management" },
    { refetchOnWindowFocus: false }
  );
  
  // Load saved tokens
  useEffect(() => {
    if (adsTokenData?.found) {
      setAdsToken(adsTokenData.accessToken || '');
      setAdsAccountId(adsTokenData.adAccountId || '');
      setMinSpend(adsTokenData.minSpend || '');
      setMinCTR(adsTokenData.minCTR || '');
    }
  }, [adsTokenData]);
  
  useEffect(() => {
    if (catalogTokenData?.found) {
      setCatalogToken(catalogTokenData.accessToken || '');
      setCatalogId(catalogTokenData.catalogId || '');
    }
  }, [catalogTokenData]);
  
  // Save Ads Token
  const handleSaveAdsToken = async () => {
    if (!adsToken.trim()) {
      toast.error('Please enter an access token');
      return;
    }
    
    setIsSavingAds(true);
    try {
      await saveTokenMutation.mutateAsync({
        tokenType: "ads_management",
        accessToken: adsToken,
        adAccountId: adsAccountId || undefined,
        minSpend: minSpend || undefined,
        minCTR: minCTR || undefined,
      });
      toast.success('Ads Report Token saved successfully');
      refetchAdsToken();
    } catch (error: any) {
      toast.error(error.message || 'Failed to save token');
    } finally {
      setIsSavingAds(false);
    }
  };
  
  // Save Catalog Token
  const handleSaveCatalogToken = async () => {
    if (!catalogToken.trim()) {
      toast.error('Please enter an access token');
      return;
    }
    
    setIsSavingCatalog(true);
    try {
      await saveTokenMutation.mutateAsync({
        tokenType: "catalog_management",
        accessToken: catalogToken,
        catalogId: catalogId || undefined,
      });
      toast.success('Catalog Token saved successfully');
      refetchCatalogToken();
    } catch (error: any) {
      toast.error(error.message || 'Failed to save token');
    } finally {
      setIsSavingCatalog(false);
    }
  };
  
  // Save Filter Preferences
  const handleSaveFilters = async () => {
    // Validate inputs
    if (minSpend && isNaN(parseFloat(minSpend))) {
      toast.error('Min Spend must be a valid number');
      return;
    }
    if (minCTR && isNaN(parseFloat(minCTR))) {
      toast.error('Min CTR must be a valid number');
      return;
    }
    
    setIsSavingFilters(true);
    try {
      // Save filter preferences with the ads token (or create a placeholder if no token exists)
      await saveTokenMutation.mutateAsync({
        tokenType: "ads_management",
        accessToken: adsToken || "placeholder",
        adAccountId: adsAccountId || undefined,
        minSpend: minSpend || undefined,
        minCTR: minCTR || undefined,
      });
      toast.success('Filter preferences saved successfully');
      refetchAdsToken();
    } catch (error: any) {
      toast.error(error.message || 'Failed to save filter preferences');
    } finally {
      setIsSavingFilters(false);
    }
  };
  
  // Delete Ads Token
  const handleDeleteAdsToken = async () => {
    setIsDeletingAds(true);
    try {
      await deleteTokenMutation.mutateAsync({ tokenType: "ads_management" });
      setAdsToken('');
      setAdsAccountId('');
      setMinSpend('');
      setMinCTR('');
      toast.success('Ads Report Token deleted');
      refetchAdsToken();
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete token');
    } finally {
      setIsDeletingAds(false);
    }
  };
  
  // Delete Catalog Token
  const handleDeleteCatalogToken = async () => {
    setIsDeletingCatalog(true);
    try {
      await deleteTokenMutation.mutateAsync({ tokenType: "catalog_management" });
      setCatalogToken('');
      setCatalogId('');
      toast.success('Catalog Token deleted');
      refetchCatalogToken();
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete token');
    } finally {
      setIsDeletingCatalog(false);
    }
  };
  
  // Clear Filter Preferences
  const handleClearFilters = async () => {
    setIsDeletingFilters(true);
    try {
      // Save with empty filter values
      await saveTokenMutation.mutateAsync({
        tokenType: "ads_management",
        accessToken: adsToken || "placeholder",
        adAccountId: adsAccountId || undefined,
        minSpend: undefined,
        minCTR: undefined,
      });
      setMinSpend('');
      setMinCTR('');
      toast.success('Filter preferences cleared');
      refetchAdsToken();
    } catch (error: any) {
      toast.error(error.message || 'Failed to clear filter preferences');
    } finally {
      setIsDeletingFilters(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <Toaster position="top-right" />
      
      {/* Header */}
      <header className="border-b border-border bg-background sticky top-0 z-20">
        <div className="container h-16 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setLocation('/')}
              className="gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Home
            </Button>
          </div>
          <h1 className="text-sm font-bold uppercase tracking-widest">Settings</h1>
          <div className="w-24" /> {/* Spacer for centering */}
        </div>
      </header>
      
      {/* Main Content */}
      <main className="flex-1 container py-8 max-w-2xl">
        <div className="space-y-6">
          
          {/* Ads Report Token Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Key className="w-5 h-5 text-primary" />
                <CardTitle>Ads Report Token</CardTitle>
              </div>
              <CardDescription>
                Access token for Facebook Ads Insights API. Requires <code>ads_read</code> permission.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ads-account-id">Ad Account ID (optional)</Label>
                <Input
                  id="ads-account-id"
                  placeholder="act_123456789"
                  value={adsAccountId}
                  onChange={(e) => setAdsAccountId(e.target.value)}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="ads-token">Access Token</Label>
                <div className="relative">
                  <Input
                    id="ads-token"
                    type={showAdsToken ? "text" : "password"}
                    placeholder="EAAxxxxxx..."
                    value={adsToken}
                    onChange={(e) => setAdsToken(e.target.value)}
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowAdsToken(!showAdsToken)}
                  >
                    {showAdsToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              
              <div className="flex gap-2">
                <Button 
                  onClick={handleSaveAdsToken} 
                  disabled={isSavingAds}
                  className="gap-2"
                >
                  {isSavingAds ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Token
                </Button>
                <Button 
                  variant="destructive" 
                  onClick={handleDeleteAdsToken}
                  disabled={isDeletingAds || !adsTokenData?.found}
                  className="gap-2"
                >
                  {isDeletingAds ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  Delete
                </Button>
              </div>
              
              {adsTokenData?.found && (
                <p className="text-xs text-muted-foreground">
                  ✓ Token saved. Last updated: stored in database.
                </p>
              )}
            </CardContent>
          </Card>
          
          {/* Filter Preferences Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Filter className="w-5 h-5 text-primary" />
                <CardTitle>Default Filter Preferences</CardTitle>
              </div>
              <CardDescription>
                Set default minimum values for filtering report data. These values will be auto-loaded when generating reports.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="min-spend">Min Spend ($)</Label>
                  <Input
                    id="min-spend"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="e.g., 10.00"
                    value={minSpend}
                    onChange={(e) => setMinSpend(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Only show products with spend ≥ this value
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="min-ctr">Min CTR (%)</Label>
                  <Input
                    id="min-ctr"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    placeholder="e.g., 0.50"
                    value={minCTR}
                    onChange={(e) => setMinCTR(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Only show products with CTR ≥ this value
                  </p>
                </div>
              </div>
              
              <div className="flex gap-2">
                <Button 
                  onClick={handleSaveFilters} 
                  disabled={isSavingFilters}
                  className="gap-2"
                >
                  {isSavingFilters ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Preferences
                </Button>
                <Button 
                  variant="outline" 
                  onClick={handleClearFilters}
                  disabled={isDeletingFilters || (!minSpend && !minCTR)}
                  className="gap-2"
                >
                  {isDeletingFilters ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  Clear
                </Button>
              </div>
              
              {(adsTokenData?.minSpend || adsTokenData?.minCTR) && (
                <p className="text-xs text-muted-foreground">
                  ✓ Filter preferences saved: Min Spend = {adsTokenData.minSpend || '0'}, Min CTR = {adsTokenData.minCTR || '0'}%
                </p>
              )}
            </CardContent>
          </Card>
          
          {/* Catalog Token Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-primary" />
                <CardTitle>Catalog Management Token</CardTitle>
              </div>
              <CardDescription>
                Access token for Facebook Catalog Batch API. Requires <code>catalog_management</code> permission.
                This is separate from the Ads Report token.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="catalog-id">Catalog ID (optional)</Label>
                <Input
                  id="catalog-id"
                  placeholder="123456789"
                  value={catalogId}
                  onChange={(e) => setCatalogId(e.target.value)}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="catalog-token">Access Token</Label>
                <div className="relative">
                  <Input
                    id="catalog-token"
                    type={showCatalogToken ? "text" : "password"}
                    placeholder="EAAxxxxxx..."
                    value={catalogToken}
                    onChange={(e) => setCatalogToken(e.target.value)}
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowCatalogToken(!showCatalogToken)}
                  >
                    {showCatalogToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              
              <div className="flex gap-2">
                <Button 
                  onClick={handleSaveCatalogToken} 
                  disabled={isSavingCatalog}
                  className="gap-2"
                >
                  {isSavingCatalog ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Token
                </Button>
                <Button 
                  variant="destructive" 
                  onClick={handleDeleteCatalogToken}
                  disabled={isDeletingCatalog || !catalogTokenData?.found}
                  className="gap-2"
                >
                  {isDeletingCatalog ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  Delete
                </Button>
              </div>
              
              {catalogTokenData?.found && (
                <p className="text-xs text-muted-foreground">
                  ✓ Token saved. Last updated: stored in database.
                </p>
              )}
            </CardContent>
          </Card>
          
        </div>
      </main>
    </div>
  );
}
