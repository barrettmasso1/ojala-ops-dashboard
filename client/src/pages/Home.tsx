import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { ArrowRight, BarChart3, ClipboardCheck, ShieldCheck, Sparkles } from "lucide-react";
import { Link } from "wouter";

export default function Home() {
  const { user, loading } = useAuth();
  const isAdmin = user?.role === "admin";

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(82,102,95,0.14),_transparent_30%),linear-gradient(180deg,_#fbf8f2_0%,_#f1eadf_55%,_#f9f5ed_100%)]">
      <div className="container py-8 md:py-12">
        <header className="flex flex-col gap-4 rounded-[2rem] border border-white/70 bg-white/78 px-6 py-5 shadow-[0_20px_60px_rgba(88,83,72,0.10)] backdrop-blur md:flex-row md:items-center md:justify-between md:px-8">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-[#818680]">Ojala Ops Dashboard</p>
            <p className="mt-2 font-serif text-2xl tracking-tight text-[#20312b]">Elegant operations for refined retail and food-service teams.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {user ? (
              <>
                <Link href="/portal" className="rounded-full border border-[#d8d0c3] bg-white/80 px-5 py-3 text-sm font-medium text-[#31423d] shadow-sm transition hover:bg-white">
                  Employee Portal
                </Link>
                {isAdmin ? (
                  <Link href="/dashboard" className="rounded-full bg-[#52665f] px-5 py-3 text-sm font-medium text-white shadow-lg shadow-[#52665f]/20 transition hover:bg-[#43554f]">
                    Manager Dashboard
                  </Link>
                ) : null}
              </>
            ) : (
              <button
                onClick={() => {
                  window.location.href = getLoginUrl();
                }}
                className="rounded-full bg-[#52665f] px-5 py-3 text-sm font-medium text-white shadow-lg shadow-[#52665f]/20 transition hover:bg-[#43554f]"
              >
                Sign in
              </button>
            )}
          </div>
        </header>

        <main className="mt-8 grid gap-8 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-[2rem] border border-white/70 bg-white/80 p-8 shadow-[0_28px_80px_rgba(88,83,72,0.12)] backdrop-blur md:p-10">
            <p className="text-xs uppercase tracking-[0.28em] text-[#7f857d]">Elegant operational intelligence</p>
            <h1 className="mt-5 max-w-4xl font-serif text-5xl tracking-tight text-[#1f2b27] md:text-6xl">
              Replace spreadsheet friction with a polished daily workflow and a dashboard that thinks clearly.
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-[#65706a]">
              Ojala Ops gives employees a clean portal for daily submissions and gives owners and managers a searchable command center for sales, checklist completion, notes, and inventory risk.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link href={user ? "/portal" : "/"} className="inline-flex items-center gap-2 rounded-full bg-[#52665f] px-6 py-3 text-sm font-medium text-white shadow-lg shadow-[#52665f]/20 transition hover:bg-[#43554f]">
                {user ? "Open Employee Portal" : "Explore the experience"}
                <ArrowRight className="h-4 w-4" />
              </Link>
              {user && isAdmin ? (
                <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-full border border-[#d6cebf] bg-white/80 px-6 py-3 text-sm font-medium text-[#31423d] shadow-sm transition hover:bg-white">
                  Open Manager Dashboard
                </Link>
              ) : null}
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {[
                {
                  title: "Employee Portal",
                  text: "Opening Checklist, Closing Checklist, and End-of-Day Report forms built for speed and clarity.",
                  icon: <ClipboardCheck className="h-5 w-5" />,
                },
                {
                  title: "Manager Dashboard",
                  text: "Daily search, payment breakdowns, weekly comparisons, inventory alerts, and recent notes in one place.",
                  icon: <BarChart3 className="h-5 w-5" />,
                },
                {
                  title: "Role-Aware Access",
                  text: "Employees see only the portal while owner and manager accounts unlock the full analytics workspace.",
                  icon: <ShieldCheck className="h-5 w-5" />,
                },
              ].map(card => (
                <div key={card.title} className="rounded-[1.75rem] border border-[#e7dfd2] bg-[#fbf7f0] p-5 shadow-sm">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#ece4d7] text-[#52665f]">{card.icon}</div>
                  <h2 className="mt-4 font-medium text-[#24342f]">{card.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-[#68716b]">{card.text}</p>
                </div>
              ))}
            </div>
          </section>

          <aside className="space-y-6">
            <section className="rounded-[2rem] border border-white/70 bg-white/82 p-7 shadow-[0_24px_70px_rgba(88,83,72,0.10)] backdrop-blur">
              <div className="flex items-center gap-3 text-[#52665f]">
                <Sparkles className="h-5 w-5" />
                <p className="text-xs uppercase tracking-[0.24em] text-[#818680]">What this app delivers</p>
              </div>
              <div className="mt-5 space-y-4 text-sm leading-6 text-[#66706a]">
                <p>Employees can submit the daily operating forms from a single refined portal that feels fast and easy to use on desktop or tablet.</p>
                <p>Owners and managers can search by date to see total sales, Cash, Card, Zelle, Venmo totals, and cups sold by 4oz, 8oz, Pint, and Liter.</p>
                <p>The notes feed aggregates low-item alerts, waste notes, closing notes, and general notes, while inventory alerts surface the categories Ingredients, Supplies, and Utensils.</p>
              </div>
            </section>

            <section className="rounded-[2rem] border border-[#ddd3c5] bg-[#f7efe2] p-7 shadow-[0_24px_70px_rgba(88,83,72,0.08)]">
              <p className="text-xs uppercase tracking-[0.24em] text-[#818680]">Current access</p>
              {loading ? (
                <p className="mt-4 text-sm text-[#68716b]">Checking your access…</p>
              ) : user ? (
                <>
                  <p className="mt-4 font-serif text-3xl tracking-tight text-[#21312c]">
                    {isAdmin ? "Owner / Manager" : "Employee"}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-[#66706a]">
                    Signed in as {user.name || "team member"}. {isAdmin ? "You can access both the employee portal and the manager dashboard." : "You can access the employee portal for form submissions."}
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-4 font-serif text-3xl tracking-tight text-[#21312c]">Guest</p>
                  <p className="mt-3 text-sm leading-6 text-[#66706a]">Sign in to continue into the role-aware portal and dashboard experience.</p>
                </>
              )}
            </section>
          </aside>
        </main>
      </div>
    </div>
  );
}
