import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ReportProvider } from "./contexts/ReportContext";
import Home from "./pages/Home";
import Settings from "./pages/Settings";
import ScheduledJobs from "./pages/ScheduledJobs";
import ScheduleHistory from "./pages/ScheduleHistory";

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/settings"} component={Settings} />
      <Route path={"/reports"} component={ScheduleHistory} />
      <Route path="/schedule-history/:id" component={ScheduleHistory} />
      <Route path={"/schedules"} component={ScheduledJobs} />
      {/* Redirect old batch-history to unified reports page */}
      <Route path={"/batch-history"}>{() => <Redirect to="/reports" />}</Route>
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <ReportProvider>
            <Router />
          </ReportProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
