import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawn } from 'child_process';
import { writeFile, unlink, mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

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

// Mock ENV
vi.mock('./_core/env', () => ({
  ENV: {
    databaseUrl: 'mysql://test:test@localhost:3306/test',
    forgeApiUrl: 'https://api.test.com',
    forgeApiKey: 'test-key',
  },
}));

describe('Report Generator - Python Worker Integration', () => {
  
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
  });

  describe('calculateDateRange', () => {
    // We test this indirectly through processReportGenerationJob
    // The function is internal but we can verify it works via config.dateRangeType
    
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
      
      // This will fail when trying to spawn Python (which is expected in test),
      // but it should get past the date validation
      try {
        await processReportGenerationJob(job, Date.now());
      } catch (e: any) {
        // Expected to fail at Python spawn stage, not at date validation
        expect(e.message).not.toContain('Missing date range');
      }
      
      // Verify createSavedReport was called (meaning date range was calculated)
      expect(createSavedReport).toHaveBeenCalled();
    });
  });

  describe('Python script syntax and imports', () => {
    
    it('should have valid Python syntax', async () => {
      const { execSync } = await import('child_process');
      const result = execSync(
        'python3.11 -c "import ast; ast.parse(open(\'python/report_worker.py\').read()); print(\'OK\')"',
        { cwd: process.cwd(), encoding: 'utf-8' }
      );
      expect(result.trim()).toBe('OK');
    });

    it('should have all required Python imports available', async () => {
      const { execSync } = await import('child_process');
      const result = execSync(
        'python3.11 -c "import aiohttp, mysql.connector, pandas; print(\'OK\')"',
        { encoding: 'utf-8' }
      );
      expect(result.trim()).toBe('OK');
    });

    it('should correctly map Facebook API data to ProductInsight', async () => {
      const { execSync } = await import('child_process');
      const testScript = `
import sys, json
sys.path.insert(0, 'python')
from report_worker import map_row_to_product_insight

row = {
    'product_name': 'Test',
    'product_retailer_id': '123',
    'impressions': '5000',
    'spend': '100.50',
    'inline_link_clicks': '200',
    'inline_link_click_ctr': '4.0',
    'cpm': '20.10',
    'cost_per_inline_link_click': '0.50',
    'converted_product_omni_purchase': '10',
    'product_views': '50',
    'actions': [{'action_type': 'omni_purchase', 'value': '15'}]
}
result = map_row_to_product_insight(row)
print(json.dumps(result))
`;
      const result = execSync(
        `python3.11 -c "${testScript.replace(/"/g, '\\"')}"`,
        { cwd: process.cwd(), encoding: 'utf-8' }
      );
      const parsed = JSON.parse(result.trim());
      
      expect(parsed.product_name).toBe('Test');
      expect(parsed.product_retailer_id).toBe('123');
      expect(parsed.impressions).toBe(5000);
      expect(parsed.spend).toBe(100.50);
      expect(parsed.link_clicks).toBe(200);
      expect(parsed.purchases).toBe(15); // from omni_purchase action
      expect(parsed.catalog_purchases).toBe(10);
      expect(parsed.cvr).toBe(5.0); // 10/200 * 100
    });

    it('should handle missing/null values gracefully in data mapping', async () => {
      const { execSync } = await import('child_process');
      const testScript = `
import sys, json
sys.path.insert(0, 'python')
from report_worker import map_row_to_product_insight

row = {}
result = map_row_to_product_insight(row)
print(json.dumps(result))
`;
      const result = execSync(
        `python3.11 -c "${testScript.replace(/"/g, '\\"')}"`,
        { cwd: process.cwd(), encoding: 'utf-8' }
      );
      const parsed = JSON.parse(result.trim());
      
      expect(parsed.product_name).toBe('N/A');
      expect(parsed.product_retailer_id).toBe('N/A');
      expect(parsed.impressions).toBe(0);
      expect(parsed.spend).toBe(0);
      expect(parsed.link_clicks).toBe(0);
      expect(parsed.purchases).toBe(0);
      expect(parsed.cvr).toBe(0);
    });
  });

  describe('DBHelper camelCase conversion', () => {
    it('should convert camelCase to snake_case correctly', async () => {
      const { execSync } = await import('child_process');
      const testScript = `
import sys, json
sys.path.insert(0, 'python')
from report_worker import DBHelper

tests = {
    'statusMessage': 'status_message',
    'processedItems': 'processed_items',
    'completedAt': 'completed_at',
    'totalItems': 'total_items',
    'durationMs': 'duration_ms',
    'status': 'status',
    'successCount': 'success_count',
    'errorCount': 'error_count',
    'completedJobs': 'completed_jobs',
    'failedJobs': 'failed_jobs',
    'totalSpend': 'total_spend',
    'totalImpressions': 'total_impressions',
}
results = {}
for k, expected in tests.items():
    actual = DBHelper._camel_to_snake(k)
    results[k] = {'expected': expected, 'actual': actual, 'match': actual == expected}
print(json.dumps(results))
`;
      const result = execSync(
        `python3.11 -c "${testScript.replace(/"/g, '\\"')}"`,
        { cwd: process.cwd(), encoding: 'utf-8' }
      );
      const parsed = JSON.parse(result.trim());
      
      for (const [key, val] of Object.entries(parsed) as any) {
        expect(val.actual).toBe(val.expected);
      }
    });
  });
});
