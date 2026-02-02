import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import axios from "axios";
import { createReadStream } from "fs";
import { Readable } from "stream";

// Mock axios
vi.mock("axios");
const mockedAxios = vi.mocked(axios);

// Mock fs
vi.mock("fs", async () => {
  const actual = await vi.importActual("fs");
  const { Writable } = await import("stream");
  return {
    ...actual,
    createReadStream: vi.fn(),
    createWriteStream: vi.fn(() => {
      const writable = new Writable({
        write(chunk, encoding, callback) {
          callback();
        }
      });
      return writable;
    }),
  };
});

// Mock fs/promises
vi.mock("fs/promises", () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockResolvedValue(undefined),
  },
  mkdir: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
}));

const mockedCreateReadStream = vi.mocked(createReadStream);

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

  it("successfully downloads CSV and parses data", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    // Mock CSV data
    const csvData = `Product Name,Impressions,Spend
Test Product,1000,50.00
Another Product,2000,100.00`;

    // Mock axios response with stream
    const mockStream = Readable.from([csvData]);
    mockedAxios.get.mockResolvedValue({
      status: 200,
      data: mockStream,
    } as any);

    // Mock CSV parser stream
    const mockCsvStream = Readable.from([
      { "Product Name": "Test Product", "Impressions": "1000", "Spend": "50.00" },
      { "Product Name": "Another Product", "Impressions": "2000", "Spend": "100.00" },
    ]);
    
    // Add headers event
    mockCsvStream.on = vi.fn((event, handler) => {
      if (event === "headers") {
        handler(["Product Name", "Impressions", "Spend"]);
      }
      return mockCsvStream;
    }) as any;

    mockedCreateReadStream.mockReturnValue(mockCsvStream as any);

    const result = await caller.facebook.downloadReportCSV({
      reportRunId: "test_report_123",
      accessToken: "test_token",
    });

    expect(result.success).toBe(true);
    expect(result.filePath).toContain(".csv");
    expect(result.previewData).toBeDefined();
    expect(result.totalRows).toBeGreaterThan(0);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining("test_report_123"),
      expect.objectContaining({
        responseType: "stream",
        timeout: 120000,
      })
    );
  });

  it("throws error when download fails", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    mockedAxios.get.mockRejectedValue(new Error("Network error"));

    await expect(
      caller.facebook.downloadReportCSV({
        reportRunId: "test_report_123",
        accessToken: "test_token",
      })
    ).rejects.toThrow("Failed to download CSV");
  });

  it("builds correct Facebook download URL", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const mockStream = Readable.from(["Product Name,Impressions\nTest,100"]);
    mockedAxios.get.mockResolvedValue({
      status: 200,
      data: mockStream,
    } as any);

    const mockCsvStream = Readable.from([
      { "Product Name": "Test", "Impressions": "100" },
    ]);
    mockCsvStream.on = vi.fn((event, handler) => {
      if (event === "headers") {
        handler(["Product Name", "Impressions"]);
      }
      return mockCsvStream;
    }) as any;
    mockedCreateReadStream.mockReturnValue(mockCsvStream as any);

    await caller.facebook.downloadReportCSV({
      reportRunId: "report_456",
      accessToken: "token_789",
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://www.facebook.com/report_456?access_token=token_789&format=csv",
      expect.any(Object)
    );
  });
});
