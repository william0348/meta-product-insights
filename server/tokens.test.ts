import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock the database functions
vi.mock("./db", () => ({
  saveUserToken: vi.fn().mockResolvedValue(undefined),
  getUserToken: vi.fn().mockResolvedValue(null),
  deleteUserToken: vi.fn().mockResolvedValue(undefined),
}));

import { saveUserToken, getUserToken, deleteUserToken } from "./db";

const mockedSaveUserToken = vi.mocked(saveUserToken);
const mockedGetUserToken = vi.mocked(getUserToken);
const mockedDeleteUserToken = vi.mocked(deleteUserToken);

function createTestContext(userId: number = 1): TrpcContext {
  return {
    user: {
      id: userId,
      openId: "test_open_id",
      name: "Test User",
      email: "test@example.com",
      loginMethod: "email",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("tokens.save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves ads token with minSpend and minCTR", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.tokens.save({
      tokenType: "ads_management",
      accessToken: "test_token_123",
      adAccountId: "123456789",
      minSpend: "10.00",
      minCTR: "0.5",
    });

    expect(result.success).toBe(true);
    expect(mockedSaveUserToken).toHaveBeenCalledWith(
      1,
      "ads_management",
      "test_token_123",
      {
        catalogId: undefined,
        adAccountId: "123456789",
        minSpend: "10.00",
        minCTR: "0.5",
      }
    );
  });

  it("saves catalog token without filter preferences", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.tokens.save({
      tokenType: "catalog_management",
      accessToken: "catalog_token_456",
      catalogId: "987654321",
    });

    expect(result.success).toBe(true);
    expect(mockedSaveUserToken).toHaveBeenCalledWith(
      1,
      "catalog_management",
      "catalog_token_456",
      {
        catalogId: "987654321",
        adAccountId: undefined,
        minSpend: undefined,
        minCTR: undefined,
      }
    );
  });
});

describe("tokens.get", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns token with minSpend and minCTR when found", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    mockedGetUserToken.mockResolvedValue({
      id: 1,
      userId: 1,
      tokenType: "ads_management",
      accessToken: "saved_token",
      catalogId: null,
      adAccountId: "123456789",
      minSpend: "5.00",
      minCTR: "1.0",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await caller.tokens.get({
      tokenType: "ads_management",
    });

    expect(result.found).toBe(true);
    expect(result.accessToken).toBe("saved_token");
    expect(result.adAccountId).toBe("123456789");
    expect(result.minSpend).toBe("5.00");
    expect(result.minCTR).toBe("1.0");
  });

  it("returns null values when token not found", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    mockedGetUserToken.mockResolvedValue(undefined);

    const result = await caller.tokens.get({
      tokenType: "ads_management",
    });

    expect(result.found).toBe(false);
    expect(result.accessToken).toBeNull();
    expect(result.minSpend).toBeNull();
    expect(result.minCTR).toBeNull();
  });
});

describe("tokens.delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes token successfully", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.tokens.delete({
      tokenType: "ads_management",
    });

    expect(result.success).toBe(true);
    expect(mockedDeleteUserToken).toHaveBeenCalledWith(1, "ads_management");
  });
});
