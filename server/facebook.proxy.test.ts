import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { exec } from "child_process";

// Mock child_process exec
vi.mock("child_process", () => ({
  exec: vi.fn(),
}));

const mockedExec = vi.mocked(exec);

function createTestContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("facebook.downloadReportCSV", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("successfully downloads CSV and saves to file via Python script", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const mockPythonResponse = JSON.stringify({
      success: true,
      file_path: "/home/ubuntu/meta-product-insights/storage/csv_cache/report_test_20260202.csv",
      preview_data: [
        { "Product Name": "Test Product", "Impressions": "1000", "Spend": "50.00" }
      ],
      total_rows: 100,
      preview_rows: 1,
      columns: ["Product Name", "Impressions", "Spend"]
    });

    // Mock exec to call callback with success
    mockedExec.mockImplementation((cmd: any, options: any, callback: any) => {
      callback(null, { stdout: mockPythonResponse, stderr: "" });
      return {} as any;
    });

    const result = await caller.facebook.downloadReportCSV({
      reportRunId: "test_report_123",
      accessToken: "test_token",
    });

    expect(result.success).toBe(true);
    expect(result.filePath).toContain("/storage/csv_cache/");
    expect(result.previewData).toHaveLength(1);
    expect(result.totalRows).toBe(100);
    expect(result.previewRows).toBe(1);
    expect(mockedExec).toHaveBeenCalledWith(
      expect.stringContaining("download_facebook_csv.py"),
      expect.objectContaining({ maxBuffer: 50 * 1024 * 1024 }),
      expect.any(Function)
    );
  });

  it("throws error when Python script fails", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const mockPythonError = JSON.stringify({
      success: false,
      error: "HTTP Error 503: Service Unavailable"
    });

    mockedExec.mockImplementation((cmd: any, options: any, callback: any) => {
      callback(null, { stdout: mockPythonError, stderr: "" });
      return {} as any;
    });

    await expect(
      caller.facebook.downloadReportCSV({
        reportRunId: "test_report_123",
        accessToken: "test_token",
      })
    ).rejects.toThrow("HTTP Error 503");
  });

  it("passes correct parameters to Python script", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const mockPythonResponse = JSON.stringify({
      success: true,
      file_path: "/test/path.csv",
      preview_data: [],
      total_rows: 0,
      preview_rows: 0,
      columns: []
    });

    mockedExec.mockImplementation((cmd: any, options: any, callback: any) => {
      callback(null, { stdout: mockPythonResponse, stderr: "" });
      return {} as any;
    });

    await caller.facebook.downloadReportCSV({
      reportRunId: "report_456",
      accessToken: "token_789",
    });

    expect(mockedExec).toHaveBeenCalledWith(
      expect.stringContaining('"report_456" "token_789"'),
      expect.any(Object),
      expect.any(Function)
    );
  });
});
