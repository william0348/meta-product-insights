import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import axios from "axios";

// Mock axios
vi.mock("axios");
const mockedAxios = vi.mocked(axios);

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
  it("successfully downloads CSV from Facebook via proxy", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const mockCsvData = `Product Name,Impressions,Spend
Test Product,1000,50.00`;

    mockedAxios.get.mockResolvedValueOnce({
      data: mockCsvData,
      status: 200,
      statusText: "OK",
      headers: {},
      config: {} as any,
    });

    const result = await caller.facebook.downloadReportCSV({
      reportRunId: "test_report_123",
      accessToken: "test_token",
    });

    expect(result.success).toBe(true);
    expect(result.csvData).toBe(mockCsvData);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining("lookaside.facebook.com"),
      expect.objectContaining({
        responseType: "text",
        timeout: 60000,
      })
    );
  });

  it("throws error when CSV download fails", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    mockedAxios.get.mockRejectedValueOnce(new Error("Network error"));

    await expect(
      caller.facebook.downloadReportCSV({
        reportRunId: "test_report_123",
        accessToken: "test_token",
      })
    ).rejects.toThrow("Failed to download CSV");
  });

  it("constructs correct Facebook lookaside URL", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    mockedAxios.get.mockResolvedValueOnce({
      data: "test",
      status: 200,
      statusText: "OK",
      headers: {},
      config: {} as any,
    });

    await caller.facebook.downloadReportCSV({
      reportRunId: "report_456",
      accessToken: "token_789",
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://lookaside.facebook.com/ads/ads_insights/download_report/business/?report_run_id=report_456&access_token=token_789",
      expect.any(Object)
    );
  });
});
