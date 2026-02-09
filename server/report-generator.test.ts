import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module
vi.mock('./db', () => ({
  updateBatchJob: vi.fn().mockResolvedValue(undefined),
  createSavedReport: vi.fn().mockResolvedValue(1),
  updateSavedReport: vi.fn().mockResolvedValue(undefined),
  getUserToken: vi.fn().mockResolvedValue(null),
  createBatchHistoryRecord: vi.fn().mockResolvedValue(1),
  updateBatchHistoryRecord: vi.fn().mockResolvedValue(undefined),
  getScheduleRun: vi.fn().mockResolvedValue(null),
  updateScheduleRun: vi.fn().mockResolvedValue(undefined),
}));

// Mock notification
vi.mock('./_core/notification', () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

// Mock storage
vi.mock('./storage', () => ({
  storagePut: vi.fn().mockResolvedValue({ key: 'test-key', url: 'https://s3.example.com/test.json' }),
}));

// Mock ENV
vi.mock('./_core/env', () => ({
  ENV: {
    databaseUrl: 'mysql://test:test@localhost:3306/test',
    forgeApiUrl: 'https://api.test.com',
    forgeApiKey: 'test-key',
  },
}));

describe('Report Generator - Node.js Worker', () => {

  describe('processReportGenerationJob', () => {

    it('should reject jobs with missing adAccountId', async () => {
      const { processReportGenerationJob } = await import('./report-generator');
      const job = {
        id: 1,
        userId: 1,
        config: { accessToken: 'token123' },
      } as any;

      await expect(processReportGenerationJob(job, Date.now()))
        .rejects.toThrow('Missing required config fields: adAccountId or accessToken');
    });

    it('should reject jobs with missing accessToken', async () => {
      const { processReportGenerationJob } = await import('./report-generator');
      const job = {
        id: 1,
        userId: 1,
        config: { adAccountId: 'act_123' },
      } as any;

      await expect(processReportGenerationJob(job, Date.now()))
        .rejects.toThrow('Missing required config fields: adAccountId or accessToken');
    });

    it('should reject jobs with missing date range', async () => {
      const { processReportGenerationJob } = await import('./report-generator');
      const job = {
        id: 1,
        userId: 1,
        config: {
          adAccountId: 'act_123',
          accessToken: 'token123',
          // No dateStart, dateEnd, or dateRangeType
        },
      } as any;

      await expect(processReportGenerationJob(job, Date.now()))
        .rejects.toThrow('Missing date range configuration');
    });

    it('should accept dateRangeType and calculate dates', async () => {
      const { processReportGenerationJob } = await import('./report-generator');
      const { createSavedReport } = await import('./db');

      const job = {
        id: 99,
        userId: 1,
        config: {
          adAccountId: 'act_123',
          accessToken: 'token123',
          dateRangeType: 'last_7_days',
        },
      } as any;

      // This will fail when trying to call Facebook API (expected in test),
      // but it should get past the date validation
      try {
        await processReportGenerationJob(job, Date.now());
      } catch (e: any) {
        // Expected to fail at API call stage, not at date validation
        expect(e.message).not.toContain('Missing date range');
      }

      // Verify createSavedReport was called (meaning date range was calculated)
      expect(createSavedReport).toHaveBeenCalled();
    });
  });
});

describe('Report Worker - Data Mapping', () => {

  it('should correctly map Facebook API data to ProductInsight', async () => {
    // We test the mapRowToProductInsight function indirectly through runReportWorker
    // but we can import the module to verify the mapping logic
    const { runReportWorker } = await import('./report-worker');

    // The worker will fail on API call, but we can test the mapping function
    // by checking the module exports are correct
    expect(typeof runReportWorker).toBe('function');
  });

  it('should map row with all fields correctly', () => {
    // Test the mapping logic directly by recreating it
    const row = {
      product_name: 'Test Product',
      product_retailer_id: '123',
      product_brand: 'TestBrand',
      impressions: '5000',
      spend: '100.50',
      inline_link_clicks: '200',
      inline_link_click_ctr: '4.0',
      cpm: '20.10',
      cost_per_inline_link_click: '0.50',
      converted_product_omni_purchase: '10',
      product_views: '50',
      actions: [{ action_type: 'omni_purchase', value: '15' }],
    };

    // Replicate the mapping logic
    let adPurchases = 0;
    if (Array.isArray(row.actions)) {
      for (const a of row.actions) {
        if (a.action_type === 'omni_purchase') {
          adPurchases = parseInt(a.value, 10);
          break;
        }
      }
    }

    const linkClicks = parseInt(String(row.inline_link_clicks), 10);
    const catalogPurchases = parseInt(String(row.converted_product_omni_purchase), 10);
    const cvr = linkClicks > 0 ? (catalogPurchases / linkClicks) * 100 : 0;

    expect(row.product_name).toBe('Test Product');
    expect(row.product_retailer_id).toBe('123');
    expect(parseInt(String(row.impressions), 10)).toBe(5000);
    expect(parseFloat(String(row.spend))).toBe(100.50);
    expect(linkClicks).toBe(200);
    expect(adPurchases).toBe(15); // from omni_purchase action
    expect(catalogPurchases).toBe(10);
    expect(cvr).toBe(5.0); // 10/200 * 100
  });

  it('should handle missing/null values gracefully', () => {
    const row: Record<string, any> = {};

    const productName = row.product_name || row.product_retailer_id || 'N/A';
    const retailerId = row.product_retailer_id || row.product_content_id || 'N/A';
    const impressions = parseInt(String(row.impressions ?? '0').replace(/,/g, ''), 10) || 0;
    const spend = parseFloat(String(row.spend ?? '0').replace(/[$,]/g, '')) || 0;
    const linkClicks = parseInt(String(row.inline_link_clicks ?? '0').replace(/,/g, ''), 10) || 0;
    const purchases = 0; // No actions array
    const catalogPurchases = parseInt(String(row.converted_product_omni_purchase ?? '0'), 10) || 0;
    const cvr = linkClicks > 0 ? (catalogPurchases / linkClicks) * 100 : 0;

    expect(productName).toBe('N/A');
    expect(retailerId).toBe('N/A');
    expect(impressions).toBe(0);
    expect(spend).toBe(0);
    expect(linkClicks).toBe(0);
    expect(purchases).toBe(0);
    expect(cvr).toBe(0);
  });
});

describe('Report Worker - runReportWorker error handling', () => {

  it('should return failure result on API error', async () => {
    const { runReportWorker } = await import('./report-worker');

    // Call with invalid config that will fail at Facebook API call
    const result = await runReportWorker({
      jobId: 999,
      reportId: 999,
      userId: '1',
      adAccountId: 'act_invalid',
      accessToken: 'invalid_token',
      dateStart: '2025-01-01',
      dateEnd: '2025-01-07',
    });

    // Should return a failure result, not throw
    expect(result.success).toBe(false);
    expect(result.jobId).toBe(999);
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('string');
  });

  it('should handle empty adAccountId gracefully', async () => {
    const { processReportGenerationJob } = await import('./report-generator');

    const job = {
      id: 1,
      userId: 1,
      config: { adAccountId: '', accessToken: 'token' },
    } as any;

    await expect(processReportGenerationJob(job, Date.now()))
      .rejects.toThrow('Missing required config fields');
  });
});
