import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import ClosingForm from "./pages/ClosingForm";
import EmployeePortal from "./pages/EmployeePortal";
import GelatoPhotoPilot from "./pages/GelatoPhotoPilot";
import Home from "./pages/Home";
import InventoryForm from "./pages/InventoryForm";
import ManagerDashboard from "./pages/ManagerDashboard";
import OpeningForm from "./pages/OpeningForm";
import StaffLogin from "./pages/StaffLogin";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/staff-login" component={StaffLogin} />
      <Route path="/portal" component={EmployeePortal} />
      <Route path="/portal/opening" component={OpeningForm} />
      <Route path="/portal/closing" component={ClosingForm} />
      <Route path="/portal/inventory" component={InventoryForm} />
      <Route path="/portal/photo-pilot" component={GelatoPhotoPilot} />
      <Route path="/dashboard/inventory" component={ManagerDashboard} />
      <Route path="/dashboard" component={ManagerDashboard} />
      <Route path="/cookbook" component={ManagerDashboard} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
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
