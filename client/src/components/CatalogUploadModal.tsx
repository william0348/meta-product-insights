import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Upload, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productCount: number;
  onUpload: (config: CatalogUploadConfig) => Promise<void>;
}

export interface CatalogUploadConfig {
  catalogId: string;
  accessToken: string;
  customLabel4: string;
  tags: string;
  customNumber0: string;
}

export const CatalogUploadModal: React.FC<Props> = ({ open, onOpenChange, productCount, onUpload }) => {
  const [catalogId, setCatalogId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [customLabel4, setCustomLabel4] = useState('');
  const [tags, setTags] = useState('');
  const [customNumber0, setCustomNumber0] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setError('');
    
    // Validation
    if (!catalogId.trim()) {
      setError('Catalog ID is required');
      return;
    }
    if (!accessToken.trim()) {
      setError('Access Token is required');
      return;
    }
    if (!customLabel4.trim() && !tags.trim() && !customNumber0.trim()) {
      setError('Please enter at least one tag or custom number');
      return;
    }

    setIsUploading(true);
    try {
      await onUpload({
        catalogId: catalogId.trim(),
        accessToken: accessToken.trim(),
        customLabel4: customLabel4.trim(),
        tags: tags.trim(),
        customNumber0: customNumber0.trim(),
      });
      
      // Reset form on success
      setCatalogId('');
      setAccessToken('');
      setCustomLabel4('');
      setTags('');
      setCustomNumber0('');
      onOpenChange(false);
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Upload className="w-5 h-5" />
            <span>Upload to Facebook Catalog</span>
          </DialogTitle>
          <DialogDescription>
            Upload {productCount} product{productCount !== 1 ? 's' : ''} to your Facebook Product Catalog with custom labels and tags.
            <br /><br />
            <strong>Note:</strong> This requires a separate access token with <code className="bg-secondary px-1 py-0.5 rounded text-xs">catalog_management</code> permission (different from the Ads Insights token).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="catalogId">Catalog ID *</Label>
            <Input
              id="catalogId"
              placeholder="e.g., 123456789"
              value={catalogId}
              onChange={(e) => setCatalogId(e.target.value)}
              disabled={isUploading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="accessToken">Catalog Access Token *</Label>
            <Input
              id="accessToken"
              type="password"
              placeholder="Separate token for catalog management"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              disabled={isUploading}
            />
            <p className="text-xs text-muted-foreground">
              Requires <code className="bg-secondary px-1 py-0.5 rounded">catalog_management</code> permission (not the same as Ads Insights token)
            </p>
          </div>

          <div className="border-t pt-4 space-y-4">
            <p className="text-sm font-medium">Update Fields (Optional)</p>
            
            <div className="space-y-2">
              <Label htmlFor="customLabel4">Custom Label 4</Label>
              <Input
                id="customLabel4"
                placeholder="e.g., High Performer"
                value={customLabel4}
                onChange={(e) => setCustomLabel4(e.target.value)}
                disabled={isUploading}
              />
              <p className="text-xs text-muted-foreground">Will be appended to existing labels (merge mode)</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tags">Tags</Label>
              <Input
                id="tags"
                placeholder="e.g., Summer, Sale"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                disabled={isUploading}
              />
              <p className="text-xs text-muted-foreground">Comma-separated. Only for Commerce Catalogs.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="customNumber0">Custom Number 0</Label>
              <Input
                id="customNumber0"
                type="number"
                placeholder="e.g., 100"
                value={customNumber0}
                onChange={(e) => setCustomNumber0(e.target.value)}
                disabled={isUploading}
              />
              <p className="text-xs text-muted-foreground">Integer value (overwrite mode)</p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isUploading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isUploading}
          >
            {isUploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Upload to Catalog
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
