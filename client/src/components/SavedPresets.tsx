import React, { useState, useEffect } from 'react';
import { FilterCondition } from '../types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Save, Trash2, Bookmark, Play } from 'lucide-react';
import { toast } from 'sonner';
import { nanoid } from 'nanoid';

interface SavedPreset {
  id: string;
  name: string;
  filters: FilterCondition[];
}

interface Props {
  currentFilters: FilterCondition[];
  onLoadPreset: (filters: FilterCondition[]) => void;
}

export const SavedPresets: React.FC<Props> = ({ currentFilters, onLoadPreset }) => {
  const [presets, setPresets] = useState<SavedPreset[]>([]);
  const [newPresetName, setNewPresetName] = useState('');

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('meta_insights_presets');
    if (saved) {
      try {
        setPresets(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse presets", e);
      }
    }
  }, []);

  // Save to localStorage whenever presets change
  useEffect(() => {
    localStorage.setItem('meta_insights_presets', JSON.stringify(presets));
  }, [presets]);

  const handleSavePreset = () => {
    if (!newPresetName.trim()) {
      toast.error("Please enter a name for the preset");
      return;
    }
    if (currentFilters.length === 0) {
      toast.error("No active filters to save");
      return;
    }

    const newPreset: SavedPreset = {
      id: nanoid(),
      name: newPresetName.trim(),
      filters: currentFilters
    };

    setPresets([...presets, newPreset]);
    setNewPresetName('');
    toast.success("Preset saved successfully");
  };

  const handleDeletePreset = (id: string) => {
    setPresets(presets.filter(p => p.id !== id));
    toast.success("Preset deleted");
  };

  return (
    <Card className="border-0 shadow-none bg-background border border-border rounded-none">
      <CardHeader className="pb-3 border-b border-border/50 px-4 pt-4">
        <div className="flex items-center space-x-2">
          <Bookmark className="w-4 h-4 text-muted-foreground" />
          <CardTitle className="text-sm font-bold uppercase tracking-tight">Saved Filter Presets</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        
        {/* Save Current */}
        <div className="flex gap-2">
          <Input 
            placeholder="Preset Name (e.g. High ROAS)" 
            value={newPresetName}
            onChange={(e) => setNewPresetName(e.target.value)}
            className="h-8 text-xs font-mono rounded-none border-border focus:border-primary"
          />
          <Button 
            onClick={handleSavePreset} 
            size="sm" 
            variant="outline" 
            className="h-8 w-8 p-0 rounded-none border-primary/50 text-primary hover:bg-primary hover:text-primary-foreground"
            title="Save Current Filters"
          >
            <Save className="w-3.5 h-3.5" />
          </Button>
        </div>

        {/* List Presets */}
        <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
          {presets.length === 0 && (
            <p className="text-[10px] text-muted-foreground italic text-center py-2">No saved presets yet.</p>
          )}
          
          {presets.map(preset => (
            <div key={preset.id} className="group flex items-center justify-between bg-secondary/30 hover:bg-secondary/60 p-2 border border-transparent hover:border-border transition-colors">
              <div className="flex flex-col overflow-hidden">
                <span className="text-xs font-bold truncate">{preset.name}</span>
                <span className="text-[10px] text-muted-foreground truncate">
                  {preset.filters.length} filters
                </span>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button 
                  onClick={() => onLoadPreset(preset.filters)}
                  size="sm" 
                  variant="ghost" 
                  className="h-6 w-6 p-0 hover:bg-emerald-100 hover:text-emerald-700"
                  title="Apply Preset"
                >
                  <Play className="w-3 h-3" />
                </Button>
                <Button 
                  onClick={() => handleDeletePreset(preset.id)}
                  size="sm" 
                  variant="ghost" 
                  className="h-6 w-6 p-0 hover:bg-destructive/10 hover:text-destructive"
                  title="Delete Preset"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>

      </CardContent>
    </Card>
  );
};
