import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

const ClosingForm = lazy(() => import("./pages/ClosingForm"));
const EmployeePortal = lazy(() => import("./pages/EmployeePortal"));
const GelatoPhotoPilot = lazy(() => import("./pages/GelatoPhotoPilot"));
const Home = lazy(() => import("./pages/Home"));
const InventoryForm = lazy(() => import("./pages/InventoryForm"));
const ManagerDashboard = lazy(() => import("./pages/ManagerDashboard"));
const OpeningForm = lazy(() => import("./pages/OpeningForm"));
const StaffLogin = lazy(() => import("./pages/StaffLogin"));

function Router() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[linear-gradient(180deg,_#fbf8f2_0%,_#f4eee4_46%,_#f8f4ec_100%)] px-6 py-12 text-[#5c544c]">
          <div className="mx-auto max-w-3xl rounded-[2rem] border border-white/70 bg-white/90 px-6 py-8 shadow-[0_20px_56px_rgba(88,83,72,0.08)]">
            Loading workspace…
          </div>
        </div>
      }
    >
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/staff-login" component={StaffLogin} />
        <Route path="/portal" component={EmployeePortal} />
        <Route path="/portal/opening" component={OpeningForm} />
        <Route path="/portal/closing" component={ClosingForm} />
        <Route path="/portal/inventory" component={InventoryForm} />
        <Route path="/portal/photo-pilot" component={GelatoPhotoPilot} />
        <Route path="/dashboard/inventory" component={ManagerDashboard} />
        <Route path="/dashboard/time-book" component={ManagerDashboard} />
        <Route path="/dashboard/forms" component={ManagerDashboard} />
        <Route path="/dashboard/history" component={ManagerDashboard} />
        <Route path="/dashboard/analysis" component={ManagerDashboard} />
        <Route path="/dashboard" component={ManagerDashboard} />
        <Route path="/cookbook" component={ManagerDashboard} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster richColors position="top-right" />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
