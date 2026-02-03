import React, { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { ArrowLeft, Save, Trash2, Key, ShoppingBag, Loader2, Eye, EyeOff } from 'lucide-react';

export default function Settings() {
  const [, setLocation] = useLocation();
  
  // Token state
  const [adsToken, setAdsToken] = useState('');
  const [adsAccountId, setAdsAccountId] = useState('');
  const [catalogToken, setCatalogToken] = useState('');
  const [catalogId, setCatalogId] = useState('');
  
  // UI state
  const [showAdsToken, setShowAdsToken] = useState(false);
  const [showCatalogToken, setShowCatalogToken] = useState(false);
  const [isSavingAds, setIsSavingAds] = useState(false);
  const [isSavingCatalog, setIsSavingCatalog] = useState(false);
  const [isDeletingAds, setIsDeletingAds] = useState(false);
  const [isDeletingCatalog, setIsDeletingCatalog] = useState(false);
  
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
  
  // Delete Ads Token
  const handleDeleteAdsToken = async () => {
    setIsDeletingAds(true);
    try {
      await deleteTokenMutation.mutateAsync({ tokenType: "ads_management" });
      setAdsToken('');
      setAdsAccountId('');
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
