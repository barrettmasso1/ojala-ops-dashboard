import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { ArrowRight, ClipboardCheck, IceCreamCone, LayoutDashboard, Package2 } from "lucide-react";
import { Link } from "wouter";

function ActionLink({ href, children, tone = "primary" }: { href: string; children: React.ReactNode; tone?: "primary" | "secondary" }) {
  return (
    <Link
      href={href}
      className={
        tone === "primary"
          ? "inline-flex items-center gap-2 rounded-full bg-[#2f2a26] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#1f1b18]"
          : "inline-flex items-center gap-2 rounded-full border border-[#ddd4c8] bg-white/88 px-6 py-3 text-sm font-medium text-[#2f2a26] transition hover:bg-white"
      }
    >
      {children}
    </Link>
  );
}

export default function Home() {
  const { user, loading } = useAuth();
  const isAdmin = user?.role === "admin";

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_#f7f1e8_0%,_#f3ece2_50%,_#f7f2ea_100%)] text-[#2d2925]">
      <div className="container py-6 md:py-8">
        <header className="soft-panel flex flex-col gap-5 rounded-[2rem] px-6 py-5 md:flex-row md:items-center md:justify-between md:px-8">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.34em] text-[#7d756b]">OJALÁ GELATO</p>
            <p className="mt-2 text-2xl font-light tracking-[-0.04em] text-[#2d2925]">Staff access and operations</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href="https://www.ojalagelato.com/"
              className="inline-flex items-center gap-2 rounded-full border border-[#ddd4c8] bg-white/88 px-5 py-3 text-sm font-medium text-[#2f2a26] transition hover:bg-white"
            >
              Customer Site
            </a>
            {user ? (
              <>
                <ActionLink href="/portal" tone="secondary">
                  Employee Access
                </ActionLink>
                {isAdmin ? <ActionLink href="/dashboard">Management Access</ActionLink> : null}
              </>
            ) : (
              <>
                <ActionLink href="/staff-login" tone="secondary">
                  Staff Login
                </ActionLink>
                <button
                  onClick={() => {
                    window.location.href = getLoginUrl();
                  }}
                  className="rounded-full bg-[#2f2a26] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#1f1b18]"
                >
                  Manager Login
                </button>
              </>
            )}
          </div>
        </header>

        <main className="mt-6 overflow-hidden rounded-[2.2rem] border border-white/70 bg-white/72 shadow-[0_26px_80px_rgba(95,84,69,0.08)] backdrop-blur">
          <section className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="relative border-b border-[#e8ddd0] px-6 py-10 md:px-10 md:py-14 lg:border-b-0 lg:border-r">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,_rgba(255,255,255,0.8),_transparent_28%),linear-gradient(135deg,_rgba(226,207,185,0.44),_rgba(247,242,234,0.18))]" />
              <div className="relative max-w-3xl">
                <p className="text-[11px] uppercase tracking-[0.34em] text-[#7d756b]">A unified Ojala subpage</p>
                <h1 className="mt-5 text-5xl font-light tracking-[-0.06em] text-[#2b2622] md:text-6xl lg:text-7xl">
                  One branded place for guests, team access, and daily operational visibility.
                </h1>
                <p className="mt-6 max-w-2xl text-base leading-8 text-[#625b53] md:text-lg">
                  This workspace now follows the same visual language as the live Ojala site so customers, employees, and managers move through one consistent brand system instead of separate disconnected tools.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  {user ? (
                    <>
                      <ActionLink href="/portal">
                        Open employee workspace
                        <ArrowRight className="h-4 w-4" />
                      </ActionLink>
                      {isAdmin ? (
                        <ActionLink href="/dashboard" tone="secondary">
                          Open dashboard
                        </ActionLink>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <ActionLink href="/staff-login">
                        Staff login
                        <ArrowRight className="h-4 w-4" />
                      </ActionLink>
                      <button
                        onClick={() => {
                          window.location.href = getLoginUrl();
                        }}
                        className="inline-flex items-center gap-2 rounded-full border border-[#ddd4c8] bg-white/88 px-6 py-3 text-sm font-medium text-[#2f2a26] transition hover:bg-white"
                      >
                        Manager login
                      </button>
                      <a
                        href="https://www.ojalagelato.com/"
                        className="inline-flex items-center gap-2 rounded-full border border-[#ddd4c8] bg-white/88 px-6 py-3 text-sm font-medium text-[#2f2a26] transition hover:bg-white"
                      >
                        Visit customer site
                      </a>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-5 px-6 py-10 md:px-8 md:py-12">
              <section className="rounded-[1.8rem] border border-[#e7ddd1] bg-[#faf6ef] p-6 shadow-sm">
                <p className="text-[11px] uppercase tracking-[0.34em] text-[#7d756b]">Login point</p>
                <p className="mt-4 text-3xl font-light tracking-[-0.05em] text-[#2d2925]">A subtle staff doorway inside the same Ojalá world.</p>
                <p className="mt-4 text-sm leading-7 text-[#655d55]">
                  Customers continue into the public site, while staff use a shared-password portal entry and management uses a separate owner login.
                </p>
              </section>

              <section className="rounded-[1.8rem] border border-[#e7ddd1] bg-[#f6efe6] p-6 shadow-sm">
                <p className="text-[11px] uppercase tracking-[0.34em] text-[#7d756b]">Current role</p>
                {loading ? (
                  <p className="mt-4 text-sm text-[#655d55]">Checking access…</p>
                ) : user ? (
                  <>
                    <p className="mt-4 text-3xl font-light tracking-[-0.05em] text-[#2d2925]">{isAdmin ? "Owner / Manager" : "Employee"}</p>
                    <p className="mt-3 text-sm leading-7 text-[#655d55]">
                      Signed in as {user.name || "team member"}. {isAdmin ? "You can move between staff inputs and the full operations dashboard." : "You will see streamlined staff-only submission access."}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-4 text-3xl font-light tracking-[-0.05em] text-[#2d2925]">Guest</p>
                    <p className="mt-3 text-sm leading-7 text-[#655d55]">Use the staff login for the employee portal, or the separate manager login for dashboard access.</p>
                  </>
                )}
              </section>
            </div>
          </section>

          <section className="grid gap-4 border-t border-[#e8ddd0] px-6 py-8 md:grid-cols-3 md:px-10 md:py-10">
            {[
              {
                title: "Opening, closing, and daily reports",
                text: "Employees get simple direct access to the essential forms they need to submit quickly.",
                icon: <ClipboardCheck className="h-5 w-5" />,
              },
              {
                title: "Inventory input",
                text: "Staff can update inventory counts without touching the manager dashboard or broader settings.",
                icon: <Package2 className="h-5 w-5" />,
              },
              {
                title: "Management visibility",
                text: "Owners and managers can review sales, notes, inventory alerts, and reporting from the same branded ecosystem.",
                icon: <LayoutDashboard className="h-5 w-5" />,
              },
            ].map(card => (
              <article key={card.title} className="rounded-[1.65rem] border border-[#ece2d7] bg-[#fbf7f1] p-5 shadow-sm">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#efe5d8] text-[#5d544a]">{card.icon}</div>
                <h2 className="mt-4 text-xl font-medium tracking-[-0.03em] text-[#2d2925]">{card.title}</h2>
                <p className="mt-3 text-sm leading-7 text-[#655d55]">{card.text}</p>
              </article>
            ))}
          </section>

          <section className="border-t border-[#e8ddd0] px-6 py-8 md:px-10 md:py-10">
            <div className="flex items-center gap-3 text-[#5d544a]">
              <IceCreamCone className="h-5 w-5" />
              <p className="text-[11px] uppercase tracking-[0.34em] text-[#7d756b]">Simple staff links</p>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: "Inventory", href: "/portal#inventory" },
                { label: "Daily Report", href: "/portal#end-of-day" },
                { label: "Closing Report", href: "/portal#closing" },
                { label: "Opening Report", href: "/portal#opening" },
              ].map(link => (
                <Link key={link.label} href={link.href} className="rounded-[1.4rem] border border-[#e6dbcf] bg-white/92 px-5 py-4 text-sm font-medium text-[#2f2a26] shadow-sm transition hover:bg-white">
                  {link.label}
                </Link>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
