const API_BASE = '/api';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    let detail = text;
    try { detail = JSON.parse(text).detail || text; } catch {}
    throw new Error(detail || `Request failed: ${res.status}`);
  }
  const text = await res.text();
  return JSON.parse(text);
}

export const apiClient = {
  auth: {
    me: () => fetchJson<any>(`${API_BASE}/auth/me`),
    logout: () => fetchJson<any>(`${API_BASE}/auth/logout`, { method: 'POST' }),
  },
  tokens: {
    get: (tokenType: string) => fetchJson<any>(`${API_BASE}/tokens/${tokenType}`),
    save: (data: any) => fetchJson<any>(`${API_BASE}/tokens`, { method: 'POST', body: JSON.stringify(data) }),
    delete: (tokenType: string) => fetchJson<any>(`${API_BASE}/tokens/${tokenType}`, { method: 'DELETE' }),
  },
  catalog: {
    fetchProducts: (data: any) => fetchJson<any>(`${API_BASE}/catalog/fetch`, { method: 'POST', body: JSON.stringify(data) }),
    batchUpdate: (data: any) => fetchJson<any>(`${API_BASE}/catalog/batch-update`, { method: 'POST', body: JSON.stringify(data) }),
    checkBatchStatus: (params: { catalogId: string; handle: string; accessToken: string; loadInvalidIds?: boolean }) => {
      const qs = new URLSearchParams({
        catalogId: params.catalogId,
        handle: params.handle,
        accessToken: params.accessToken,
        loadInvalidIds: String(params.loadInvalidIds ?? false),
      });
      return fetchJson<any>(`${API_BASE}/catalog/batch-status?${qs}`);
    },
  },
  batchHistory: {
    getMyHistory: (limit = 50) => fetchJson<any>(`${API_BASE}/batch-history?limit=${limit}`),
    getByCatalog: (catalogId: string, limit = 50) => fetchJson<any>(`${API_BASE}/batch-history/catalog/${catalogId}?limit=${limit}`),
    getAll: (limit = 100) => fetchJson<any>(`${API_BASE}/batch-history/all?limit=${limit}`),
  },
  jobs: {
    submit: (data: any) => fetchJson<any>(`${API_BASE}/jobs`, { method: 'POST', body: JSON.stringify(data) }),
    getStatus: (jobId: number) => fetchJson<any>(`${API_BASE}/jobs/${jobId}`),
    getMyJobs: (limit = 20) => fetchJson<any>(`${API_BASE}/jobs?limit=${limit}`),
    cancel: (jobId: number) => fetchJson<any>(`${API_BASE}/jobs/${jobId}/cancel`, { method: 'POST' }),
  },
  facebook: {
    getInsightsData: (params: { reportRunId: string; accessToken: string; limit?: number; after?: string }) => {
      const qs = new URLSearchParams({
        reportRunId: params.reportRunId,
        accessToken: params.accessToken,
        limit: String(params.limit ?? 5000),
      });
      if (params.after) qs.set('after', params.after);
      return fetchJson<any>(`${API_BASE}/facebook/insights?${qs}`);
    },
    refilter: (params: { reportRunId: string; minSpend?: string; minCTR?: string; maxSpend?: string; maxCVR?: string; maxResults?: number }) => {
      const qs = new URLSearchParams({ reportRunId: params.reportRunId });
      if (params.minSpend) qs.set('minSpend', params.minSpend);
      if (params.minCTR) qs.set('minCTR', params.minCTR);
      if (params.maxSpend) qs.set('maxSpend', params.maxSpend);
      if (params.maxCVR) qs.set('maxCVR', params.maxCVR);
      if (params.maxResults) qs.set('maxResults', String(params.maxResults));
      return fetchJson<any>(`${API_BASE}/facebook/insights/refilter?${qs}`);
    },
    fetchAll: (params: { reportRunId: string; accessToken: string; minSpend?: string; minCTR?: string; maxSpend?: string; maxCVR?: string }) => {
      const qs = new URLSearchParams({
        reportRunId: params.reportRunId,
        accessToken: params.accessToken,
        limit: '5000',
        fetchAll: 'true',
      });
      if (params.minSpend) qs.set('minSpend', params.minSpend);
      if (params.minCTR) qs.set('minCTR', params.minCTR);
      if (params.maxSpend) qs.set('maxSpend', params.maxSpend);
      if (params.maxCVR) qs.set('maxCVR', params.maxCVR);
      return fetchJson<any>(`${API_BASE}/facebook/insights?${qs}`);
    },
  },
  reports: {
    generate: (data: any) => fetchJson<any>(`${API_BASE}/reports/generate`, { method: 'POST', body: JSON.stringify(data) }),
    get: (reportId: number) => fetchJson<any>(`${API_BASE}/reports/${reportId}`),
    getMyReports: (limit = 50) => fetchJson<any>(`${API_BASE}/reports?limit=${limit}`),
    delete: (reportId: number) => fetchJson<any>(`${API_BASE}/reports/${reportId}`, { method: 'DELETE' }),
  },
  schedules: {
    create: (data: any) => fetchJson<any>(`${API_BASE}/schedules`, { method: 'POST', body: JSON.stringify(data) }),
    get: (scheduleId: number) => fetchJson<any>(`${API_BASE}/schedules/${scheduleId}`),
    getMySchedules: (limit = 50) => fetchJson<any>(`${API_BASE}/schedules?limit=${limit}`),
    update: (scheduleId: number, data: any) => fetchJson<any>(`${API_BASE}/schedules/${scheduleId}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (scheduleId: number) => fetchJson<any>(`${API_BASE}/schedules/${scheduleId}`, { method: 'DELETE' }),
    runNow: (scheduleId: number) => fetchJson<any>(`${API_BASE}/schedules/${scheduleId}/run`, { method: 'POST' }),
    cancelJob: (jobId: number) => fetchJson<any>(`${API_BASE}/schedules/jobs/${jobId}/cancel`, { method: 'POST' }),
    getHistory: (scheduleId: number, limit = 50) => fetchJson<any>(`${API_BASE}/schedules/${scheduleId}/history?limit=${limit}`),
    getAllHistory: (limit = 50) => fetchJson<any>(`${API_BASE}/schedules/history/all?limit=${limit}`),
    getRunDetail: (runId: number) => fetchJson<any>(`${API_BASE}/schedules/runs/${runId}`),
  },
  monitors: {
    list: () => fetchJson<any>(`${API_BASE}/monitors`),
    create: (data: any) => fetchJson<any>(`${API_BASE}/monitors`, { method: 'POST', body: JSON.stringify(data) }),
    get: (id: number) => fetchJson<any>(`${API_BASE}/monitors/${id}`),
    update: (id: number, data: any) => fetchJson<any>(`${API_BASE}/monitors/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: number) => fetchJson<any>(`${API_BASE}/monitors/${id}`, { method: 'DELETE' }),
    runNow: (id: number) => fetchJson<any>(`${API_BASE}/monitors/${id}/run`, { method: 'POST' }),
    listSnapshots: (id: number, limit = 50) => fetchJson<any>(`${API_BASE}/monitors/${id}/snapshots?limit=${limit}`),
    getSnapshot: (id: number, snapId: number) => fetchJson<any>(`${API_BASE}/monitors/${id}/snapshots/${snapId}`),
  },
};
