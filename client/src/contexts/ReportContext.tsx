import React, { createContext, useContext, useState, useRef, useCallback } from 'react';
import { AsyncJobStatus, ProductInsightData, FilterCondition } from '../types';

interface ReportState {
  // Core report state
  reportId: string | null;
  jobStatus: AsyncJobStatus;
  jobPercent: number;
  reportData: ProductInsightData[] | null;
  isRequesting: boolean;
  isFetchingMore: boolean;
  downloadProgress: number;
  loadedRowCount: number;
  isLoadingComplete: boolean;
  apiError: string | null;
  
  // Filtering
  activeFilters: FilterCondition[];
  
  // Access token for current job
  activeAccessToken: string | undefined;
  
  // Catalog upload
  catalogModalOpen: boolean;
  catalogUploading: boolean;
  
  // Background job
  activeJobId: number | null;
}

interface ReportContextType extends ReportState {
  // Setters
  setReportId: React.Dispatch<React.SetStateAction<string | null>>;
  setJobStatus: React.Dispatch<React.SetStateAction<AsyncJobStatus>>;
  setJobPercent: React.Dispatch<React.SetStateAction<number>>;
  setReportData: React.Dispatch<React.SetStateAction<ProductInsightData[] | null>>;
  setIsRequesting: React.Dispatch<React.SetStateAction<boolean>>;
  setIsFetchingMore: React.Dispatch<React.SetStateAction<boolean>>;
  setDownloadProgress: React.Dispatch<React.SetStateAction<number>>;
  setLoadedRowCount: React.Dispatch<React.SetStateAction<number>>;
  setIsLoadingComplete: React.Dispatch<React.SetStateAction<boolean>>;
  setApiError: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveFilters: React.Dispatch<React.SetStateAction<FilterCondition[]>>;
  setActiveAccessToken: React.Dispatch<React.SetStateAction<string | undefined>>;
  setCatalogModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setCatalogUploading: React.Dispatch<React.SetStateAction<boolean>>;
  setActiveJobId: React.Dispatch<React.SetStateAction<number | null>>;
  
  // Poll interval ref (persists across navigation)
  pollIntervalRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>;
}

const ReportContext = createContext<ReportContextType | null>(null);

export function ReportProvider({ children }: { children: React.ReactNode }) {
  // Core report state
  const [reportId, setReportId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<AsyncJobStatus>(AsyncJobStatus.NOT_STARTED);
  const [jobPercent, setJobPercent] = useState<number>(0);
  const [reportData, setReportData] = useState<ProductInsightData[] | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [loadedRowCount, setLoadedRowCount] = useState<number>(0);
  const [isLoadingComplete, setIsLoadingComplete] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  
  // Filtering
  const [activeFilters, setActiveFilters] = useState<FilterCondition[]>([]);
  
  // Access token
  const [activeAccessToken, setActiveAccessToken] = useState<string | undefined>(undefined);
  
  // Catalog
  const [catalogModalOpen, setCatalogModalOpen] = useState(false);
  const [catalogUploading, setCatalogUploading] = useState(false);
  
  // Background job
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  
  // Poll interval ref - persists across navigation since context never unmounts
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  return (
    <ReportContext.Provider value={{
      reportId, setReportId,
      jobStatus, setJobStatus,
      jobPercent, setJobPercent,
      reportData, setReportData,
      isRequesting, setIsRequesting,
      isFetchingMore, setIsFetchingMore,
      downloadProgress, setDownloadProgress,
      loadedRowCount, setLoadedRowCount,
      isLoadingComplete, setIsLoadingComplete,
      apiError, setApiError,
      activeFilters, setActiveFilters,
      activeAccessToken, setActiveAccessToken,
      catalogModalOpen, setCatalogModalOpen,
      catalogUploading, setCatalogUploading,
      activeJobId, setActiveJobId,
      pollIntervalRef,
    }}>
      {children}
    </ReportContext.Provider>
  );
}

export function useReportState() {
  const context = useContext(ReportContext);
  if (!context) {
    throw new Error('useReportState must be used within a ReportProvider');
  }
  return context;
}
