import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installGlobalErrorHandlers, logger } from "./lib/logger";
import { registerSciStudioTools } from "./webmcp/register";
import "./index.css";

// #1741: install global error handlers + wrap the app in an ErrorBoundary so
// frontend crashes/rejections are logged and refluxed to the backend instead of
// disappearing into the DevTools console no beta tester opens.
installGlobalErrorHandlers();
logger.info("app starting");

// WebMCP: expose SciStudio's tools to a browser AI agent. Fire-and-forget on
// purpose — the app is fully usable without it, and on a browser that has not
// enabled the origin trial this resolves to 0 registrations and says so.
void registerSciStudioTools();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
