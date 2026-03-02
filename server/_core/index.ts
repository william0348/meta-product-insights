import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { startJobProcessor } from "../job-processor";
import { startScheduler } from "../scheduler";
import { agentRouter } from "../agent-api";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // Agent API (for Manus Agent external access)
  app.use("/api/agent", agentRouter);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = parseInt(process.env.PORT || "3000");
  
  // In production, use the PORT env directly without port scanning
  // In development, find an available port if needed
  const finalPort = process.env.NODE_ENV === "production" 
    ? port 
    : await findAvailablePort(port);

  if (finalPort !== port && process.env.NODE_ENV !== "production") {
    console.log(`Port ${port} is busy, using port ${finalPort} instead`);
  }

  // Bind to 0.0.0.0 to accept connections from outside the container
  server.listen(finalPort, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${finalPort}/`);
    
    // Start the background job processor and scheduler.
    // Note: In development mode with tsx watch, file changes trigger hot-reload
    // which can kill running worker processes. The in-memory heartbeat mechanism
    // and mega retry logic handle this gracefully.
    startJobProcessor();
    startScheduler();
  });
}

startServer().catch(console.error);
