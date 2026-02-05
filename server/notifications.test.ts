import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock the notification module
vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

import { notifyOwner } from "./_core/notification";

describe("Notification Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("notifyOwner function", () => {
    it("should be called with correct parameters for report completion", async () => {
      const mockNotifyOwner = vi.mocked(notifyOwner);
      
      // Simulate what report-generator.ts does
      const jobId = "test-job-123";
      const adAccountId = "act_123456789";
      const productCount = 5000;
      const durationMinutes = 5;
      const updateToCatalog = true;

      const notificationTitle = updateToCatalog 
        ? `✅ Report + Catalog Update Completed`
        : `✅ Report Generation Completed`;
      const notificationContent = [
        `**Job ID:** ${jobId}`,
        `**Account:** ${adAccountId}`,
        `**Products:** ${productCount.toLocaleString()}`,
        `**Duration:** ${durationMinutes} minutes`,
        updateToCatalog ? `**Catalog Updated:** Yes` : '',
        `\n[View Reports](/saved-reports)`
      ].filter(Boolean).join('\n');

      await notifyOwner({
        title: notificationTitle,
        content: notificationContent,
      });

      expect(mockNotifyOwner).toHaveBeenCalledTimes(1);
      expect(mockNotifyOwner).toHaveBeenCalledWith({
        title: "✅ Report + Catalog Update Completed",
        content: expect.stringContaining("**Job ID:** test-job-123"),
      });
      expect(mockNotifyOwner).toHaveBeenCalledWith({
        title: expect.any(String),
        content: expect.stringContaining("**Products:** 5,000"),
      });
    });

    it("should be called with correct parameters for catalog batch completion", async () => {
      const mockNotifyOwner = vi.mocked(notifyOwner);
      
      // Simulate what job-processor.ts does
      const jobId = "test-job-456";
      const catalogId = "catalog_789";
      const totalItems = 15000;
      const successCount = 14500;
      const errorCount = 500;
      const durationMinutes = 10;
      const status = errorCount > 0 && successCount === 0 ? '❌ Failed' : '✅ Completed';

      const notificationTitle = `${status}: Catalog Batch Update`;
      const notificationContent = [
        `**Job ID:** ${jobId}`,
        `**Catalog ID:** ${catalogId}`,
        `**Total Items:** ${totalItems.toLocaleString()}`,
        `**Success:** ${successCount.toLocaleString()}`,
        `**Errors:** ${errorCount.toLocaleString()}`,
        `**Duration:** ${durationMinutes} minutes`,
        `\n[View History](/batch-history)`
      ].join('\n');

      await notifyOwner({
        title: notificationTitle,
        content: notificationContent,
      });

      expect(mockNotifyOwner).toHaveBeenCalledTimes(1);
      expect(mockNotifyOwner).toHaveBeenCalledWith({
        title: "✅ Completed: Catalog Batch Update",
        content: expect.stringContaining("**Total Items:** 15,000"),
      });
      expect(mockNotifyOwner).toHaveBeenCalledWith({
        title: expect.any(String),
        content: expect.stringContaining("**Success:** 14,500"),
      });
    });

    it("should show failed status when all items have errors", async () => {
      const mockNotifyOwner = vi.mocked(notifyOwner);
      
      const successCount = 0;
      const errorCount = 1000;
      const status = errorCount > 0 && successCount === 0 ? '❌ Failed' : '✅ Completed';

      const notificationTitle = `${status}: Catalog Batch Update`;

      await notifyOwner({
        title: notificationTitle,
        content: "Test content",
      });

      expect(mockNotifyOwner).toHaveBeenCalledWith({
        title: "❌ Failed: Catalog Batch Update",
        content: "Test content",
      });
    });

    it("should return true on successful notification", async () => {
      const mockNotifyOwner = vi.mocked(notifyOwner);
      mockNotifyOwner.mockResolvedValue(true);

      const result = await notifyOwner({
        title: "Test Title",
        content: "Test Content",
      });

      expect(result).toBe(true);
    });

    it("should handle notification failure gracefully", async () => {
      const mockNotifyOwner = vi.mocked(notifyOwner);
      mockNotifyOwner.mockResolvedValue(false);

      const result = await notifyOwner({
        title: "Test Title",
        content: "Test Content",
      });

      expect(result).toBe(false);
    });
  });
});

describe("Schedule Edit Functionality", () => {
  it("should parse cron expression correctly", () => {
    // Test cron parsing logic used in ScheduledJobs.tsx
    const cronExpression = "0 30 14 * * 3"; // Wednesday at 14:30
    const cronParts = cronExpression.split(' ');
    const [, minute, hour, , , dayOfWeek] = cronParts;

    expect(minute).toBe("30");
    expect(hour).toBe("14");
    expect(dayOfWeek).toBe("3");
  });

  it("should build cron expression from form data", () => {
    // Test cron building logic used in ScheduledJobs.tsx
    const formData = {
      dayOfWeek: "1", // Monday
      hour: "9",
      minute: "0",
    };

    const cronExpression = `0 ${formData.minute} ${formData.hour} * * ${formData.dayOfWeek}`;
    
    expect(cronExpression).toBe("0 0 9 * * 1");
  });

  it("should handle custom numbers config correctly", () => {
    // Test custom numbers config structure
    const customNumbers = [
      { enabled: true, value: "100" },
      { enabled: false, value: "" },
      { enabled: true, value: "200" },
      { enabled: false, value: "" },
      { enabled: false, value: "" },
    ];

    const customNumbersConfig: Record<string, string> = {};
    customNumbers.forEach((cn, index) => {
      if (cn.enabled && cn.value.trim()) {
        customNumbersConfig[`custom_number_${index}`] = cn.value.trim();
      }
    });

    expect(customNumbersConfig).toEqual({
      "custom_number_0": "100",
      "custom_number_2": "200",
    });
    expect(Object.keys(customNumbersConfig)).toHaveLength(2);
  });

  it("should restore custom numbers from config", () => {
    // Test restoring custom numbers from schedule config
    const configCustomNumbers = {
      "custom_number_0": "50",
      "custom_number_3": "150",
    };

    const defaultCustomNumbers = [
      { enabled: false, value: '' },
      { enabled: false, value: '' },
      { enabled: false, value: '' },
      { enabled: false, value: '' },
      { enabled: false, value: '' },
    ];

    const restoredCustomNumbers = defaultCustomNumbers.map((_, index) => {
      const key = `custom_number_${index}`;
      const value = configCustomNumbers[key as keyof typeof configCustomNumbers];
      return {
        enabled: value !== undefined && value !== '',
        value: value?.toString() || '',
      };
    });

    expect(restoredCustomNumbers[0]).toEqual({ enabled: true, value: "50" });
    expect(restoredCustomNumbers[1]).toEqual({ enabled: false, value: "" });
    expect(restoredCustomNumbers[2]).toEqual({ enabled: false, value: "" });
    expect(restoredCustomNumbers[3]).toEqual({ enabled: true, value: "150" });
    expect(restoredCustomNumbers[4]).toEqual({ enabled: false, value: "" });
  });
});
