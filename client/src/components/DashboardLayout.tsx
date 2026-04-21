import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { getLoginUrl } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import { BarChart3, ClipboardList, LogOut, PanelLeft, ShieldCheck } from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";

const menuItems: Array<{
  icon: typeof BarChart3;
  label: string;
  path: string;
  roles: Array<"admin" | "user">;
}> = [
  { icon: BarChart3, label: "Dashboard", path: "/dashboard", roles: ["admin"] },
  { icon: ClipboardList, label: "Employee Portal", path: "/portal", roles: ["admin", "user"] },
];

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 292;
const MIN_WIDTH = 220;
const MAX_WIDTH = 420;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />;
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(95,127,120,0.16),_transparent_35%),linear-gradient(180deg,_#f9f6f0_0%,_#f3ece1_55%,_#f7f4ee_100%)] px-6 py-12">
        <div className="w-full max-w-md rounded-[2rem] border border-white/70 bg-white/80 p-10 text-center shadow-[0_30px_80px_rgba(84,77,63,0.12)] backdrop-blur">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-[#e9dfcf] text-[#52665f]">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h1 className="text-3xl font-medium tracking-[-0.04em] text-[#1f2a27]">Sign in to continue</h1>
          <p className="mt-4 text-sm leading-6 text-[#5c645e]">
            This workspace is reserved for authenticated Ojala team members. Continue to access the employee portal or the management dashboard.
          </p>
          <Button
            onClick={() => {
              window.location.href = getLoginUrl();
            }}
            size="lg"
            className="mt-8 w-full rounded-full bg-[#52665f] text-white shadow-lg shadow-[#52665f]/20 hover:bg-[#41534d]"
          >
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={{
        "--sidebar-width": `${sidebarWidth}px`,
      } as CSSProperties}
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>{children}</DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({ children, setSidebarWidth }: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const visibleMenuItems = menuItems.filter(item => item.roles.includes((user?.role ?? "user") as "admin" | "user"));
  const activeMenuItem = visibleMenuItems.find(item => location.startsWith(item.path));
  const isMobile = useIsMobile();

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar collapsible="icon" className="border-r-0 bg-transparent" disableTransition={isResizing}>
          <SidebarHeader className="h-20 justify-center border-r border-[#d7d0c4]/70 bg-[#f6efe4]/70 px-4 backdrop-blur">
            <div className="flex w-full items-center gap-3 px-2">
              <button
                onClick={toggleSidebar}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/70 text-[#52665f] shadow-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#52665f]"
                aria-label="Toggle navigation"
              >
                <PanelLeft className="h-4 w-4" />
              </button>
              {!isCollapsed ? (
                <div className="min-w-0">
                  <p className="text-xl font-medium tracking-[-0.04em] text-[#21312d]">Ojalá Gelato</p>
                  <p className="text-xs uppercase tracking-[0.28em] text-[#7a8077]">Staff access and operations</p>
                </div>
              ) : null}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0 border-r border-[#d7d0c4]/70 bg-[#f8f3eb]/85 px-2 py-4 backdrop-blur">
            <div className="mb-5 rounded-[1.5rem] border border-white/70 bg-white/75 p-4 text-[#44524e] shadow-[0_16px_35px_rgba(88,83,72,0.08)] group-data-[collapsible=icon]:hidden">
              <p className="text-xs uppercase tracking-[0.24em] text-[#8b8f87]">Today’s focus</p>
              <p className="mt-2 text-lg font-medium tracking-[-0.03em] text-[#20312b]">Calm operations. Clear reporting.</p>
              <p className="mt-2 text-sm leading-6 text-[#66706a]">
                Review daily performance, inspect notes, and catch inventory risk before it becomes a service issue.
              </p>
            </div>
            <SidebarMenu className="px-2 py-1">
              {visibleMenuItems.map(item => {
                const isActive = location.startsWith(item.path);
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => setLocation(item.path)}
                      tooltip={item.label}
                      className="h-12 rounded-xl text-[#4e5e59] transition-all data-[active=true]:bg-[#52665f] data-[active=true]:text-white data-[active=true]:shadow-lg data-[active=true]:shadow-[#52665f]/20"
                    >
                      <item.icon className="h-4 w-4" />
                      <span className="font-medium">{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="border-r border-[#d7d0c4]/70 bg-[#f8f3eb]/85 p-4 backdrop-blur">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex w-full items-center gap-3 rounded-2xl border border-white/70 bg-white/80 px-3 py-3 text-left shadow-sm transition-colors hover:bg-white group-data-[collapsible=icon]:justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#52665f]">
                  <Avatar className="h-10 w-10 border border-[#d8d2c7] bg-[#e7ddcf] text-[#354743]">
                    <AvatarFallback className="bg-[#e7ddcf] text-sm font-semibold text-[#354743]">
                      {user?.name?.charAt(0).toUpperCase() ?? "O"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                    <p className="truncate text-sm font-medium text-[#24332f]">{user?.name || "Team member"}</p>
                    <p className="mt-1 truncate text-xs text-[#7a8077]">{user?.role === "admin" ? "Owner / Manager" : "Employee"}</p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 rounded-xl border-[#e5ddd0] bg-white/95 backdrop-blur">
                <DropdownMenuItem onClick={logout} className="cursor-pointer text-destructive focus:text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute right-0 top-0 h-full w-1 cursor-col-resize transition-colors hover:bg-[#52665f]/20 ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset className="bg-[radial-gradient(circle_at_top,_rgba(82,102,95,0.14),_transparent_28%),linear-gradient(180deg,_#fbf8f2_0%,_#f5efe6_48%,_#f9f5ed_100%)]">
        {isMobile && (
          <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-[#d9d1c5]/70 bg-[#f9f4ec]/90 px-3 backdrop-blur">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="h-9 w-9 rounded-full bg-white/80 text-[#52665f] shadow-sm" />
              <div>
                <p className="text-lg font-medium tracking-[-0.03em] text-[#20312b]">{activeMenuItem?.label ?? "Workspace"}</p>
              </div>
            </div>
          </div>
        )}
        <main className="flex-1 p-4 md:p-6 lg:p-8">{children}</main>
      </SidebarInset>
    </>
  );
}
