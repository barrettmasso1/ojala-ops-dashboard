import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { ClipboardCheck, LayoutDashboard, Package2 } from "lucide-react";
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
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const staffLinks = [
    { label: "Opening Form", href: "/portal/opening" },
    { label: "Closing Form", href: "/portal/closing" },
    { label: "Portal Home", href: "/portal" },
  ];

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_#f7f1e8_0%,_#f3ece2_50%,_#f7f2ea_100%)] text-[#2d2925]">
      <div className="container py-6 md:py-8">
        <header className="soft-panel flex flex-col gap-5 rounded-[2rem] px-6 py-5 md:flex-row md:items-center md:justify-between md:px-8">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.34em] text-[#7d756b]">OJALÁ GELATO</p>
            <h1 className="mt-2 text-3xl font-light tracking-[-0.05em] text-[#2d2925] md:text-4xl">Operations dashboard</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[#625b53] md:text-base">
              Staff can open or close the shop quickly from iPad or phone, while managers keep a separate dashboard for review.
            </p>
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
                <ActionLink href="/portal/opening" tone="secondary">
                  Staff Forms
                </ActionLink>
                {isAdmin ? <ActionLink href="/dashboard">Manager Dashboard</ActionLink> : null}
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

        <main className="mt-6 space-y-6 overflow-hidden rounded-[2.2rem] border border-white/70 bg-white/72 p-6 shadow-[0_26px_80px_rgba(95,84,69,0.08)] backdrop-blur md:p-10">
          <section className="grid gap-4 md:grid-cols-3">
            {[
              {
                title: "Opening and closing forms",
                text: "Separate staff forms keep drawer cash, gelato counts, and checklist questions shorter and easier to finish on mobile.",
                icon: <ClipboardCheck className="h-5 w-5" />,
              },
              {
                title: "Inventory visibility",
                text: "Side-by-side cups, lids, spoon, and bag counts make it easier to record front counter stock without a long scrolling page.",
                icon: <Package2 className="h-5 w-5" />,
              },
              {
                title: "Manager review",
                text: "Managers keep a separate dashboard for daily submissions, sales, alerts, discrepancies, and cookbook visibility.",
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

          <section className="rounded-[1.8rem] border border-[#e8ddd0] bg-[#faf6ef] p-6">
            <p className="text-[11px] uppercase tracking-[0.34em] text-[#7d756b]">Staff links</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {staffLinks.map(link => (
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
