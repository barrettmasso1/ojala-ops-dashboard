import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";

export default function StaffLogin() {
  const [, setLocation] = useLocation();
  const { user, loading, refresh } = useAuth();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const staffLoginMutation = trpc.auth.staffPortalLogin.useMutation({
    onSuccess: async () => {
      await refresh();
      toast.success("Staff access granted.");
      setLocation("/portal/opening");
    },
    onError: () => {
      toast.error("The staff password was not correct.");
    },
  });

  useEffect(() => {
    if (loading || !user) return;
    setLocation(user.role === "admin" ? "/dashboard" : "/portal/opening");
  }, [loading, setLocation, user]);

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_#f7f1e8_0%,_#f3ece2_50%,_#f7f2ea_100%)] text-[#2d2925]">
      <div className="container flex min-h-screen items-center py-8">
        <div className="mx-auto grid w-full max-w-5xl overflow-hidden rounded-[2.2rem] border border-white/70 bg-white/78 shadow-[0_26px_80px_rgba(95,84,69,0.08)] backdrop-blur lg:grid-cols-[1.05fr_0.95fr]">
          <section className="border-b border-[#e8ddd0] px-6 py-10 md:px-10 lg:border-b-0 lg:border-r lg:py-14">
            <p className="text-[11px] uppercase tracking-[0.34em] text-[#7d756b]">OJALÁ GELATO</p>
            <h1 className="mt-5 text-4xl font-light tracking-[-0.06em] text-[#2b2622] md:text-5xl">
Staff portal access for the opening and closing forms.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-[#625b53] md:text-lg">
Employees can sign in here with the shared shop password on iPad or phone, move directly into the opening form, and keep the manager dashboard separate.
            </p>
            <div className="mt-8 grid gap-4">
              <article className="rounded-[1.6rem] border border-[#e7ddd1] bg-[#faf6ef] p-5 shadow-sm">
                <div className="flex items-center gap-3 text-[#5d544a]">
                  <LockKeyhole className="h-5 w-5" />
                  <p className="text-xs uppercase tracking-[0.28em] text-[#7d756b]">Shared staff login</p>
                </div>
                <p className="mt-3 text-sm leading-7 text-[#655d55]">
                  Use the shared team password only. No username is required for the employee portal.
                </p>
              </article>
              <article className="rounded-[1.6rem] border border-[#e7ddd1] bg-[#f6efe6] p-5 shadow-sm">
                <div className="flex items-center gap-3 text-[#5d544a]">
                  <ShieldCheck className="h-5 w-5" />
                  <p className="text-xs uppercase tracking-[0.28em] text-[#7d756b]">Manager access stays separate</p>
                </div>
                <p className="mt-3 text-sm leading-7 text-[#655d55]">
                  The owner dashboard continues to use the separate manager login path, so staff do not see dashboard administration tools.
                </p>
              </article>
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/" className="inline-flex items-center gap-2 rounded-full border border-[#ddd4c8] bg-white/88 px-5 py-3 text-sm font-medium text-[#2f2a26] transition hover:bg-white">
                <ArrowLeft className="h-4 w-4" />
                Back home
              </Link>
              <button
                type="button"
                onClick={() => {
                  window.location.href = getLoginUrl("/dashboard");
                }}
                className="inline-flex items-center gap-2 rounded-full bg-[#2f2a26] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#1f1b18]"
              >
                Manager login
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </section>

          <section className="px-6 py-10 md:px-10 lg:py-14">
            <div className="rounded-[1.8rem] border border-[#e7ddd1] bg-[#fbf7f1] p-6 shadow-sm md:p-8">
              <p className="text-[11px] uppercase tracking-[0.34em] text-[#7d756b]">Employee entry</p>
              <h2 className="mt-4 text-3xl font-light tracking-[-0.05em] text-[#2d2925]">Enter the shared staff password</h2>
              <p className="mt-4 text-sm leading-7 text-[#655d55]">
After sign-in, the portal opens directly to the opening form with the current business date already prepared.
              </p>

              <form
                className="mt-8 grid gap-5"
                onSubmit={event => {
                  event.preventDefault();
                  staffLoginMutation.mutate({ password });
                }}
              >
                <label className="grid gap-2 text-sm font-medium text-[#453f39]">
                  Shared staff password
                  <div className="relative">
                    <input
                      className="h-12 w-full rounded-2xl border border-[#d7cec0] bg-white px-4 pr-14 text-base text-[#2d2925] outline-none transition focus:border-[#9d8f7d] focus:ring-2 focus:ring-[#d8cebe]"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      value={password}
                      onChange={event => setPassword(event.target.value)}
                      placeholder="Enter shop password"
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      onClick={() => setShowPassword(current => !current)}
                      className="absolute inset-y-1.5 right-1.5 inline-flex items-center justify-center rounded-xl px-3 text-[#6b6258] transition hover:bg-[#f4ede2] hover:text-[#2d2925]"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </label>
                <button
                  type="submit"
                  disabled={staffLoginMutation.isPending || password.trim().length === 0}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-[#2f2a26] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#1f1b18] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {staffLoginMutation.isPending ? "Opening form..." : "Open opening form"}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </form>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
