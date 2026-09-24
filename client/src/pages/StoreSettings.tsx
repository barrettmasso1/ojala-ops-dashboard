import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type Form = {
  nombre: string; duenoEmail: string; horarioApertura: string;
  horarioCierre: string; posType: "none" | "square" | "toast" | "shopify" | "other";
};

const emptyForm: Form = { nombre: "", duenoEmail: "", horarioApertura: "", horarioCierre: "", posType: "none" };
const posOptions = ["none", "square", "toast", "shopify", "other"] as const;
const fieldClass = "w-full rounded-xl border border-[#d7d0c4] bg-white px-3 py-2 text-[#1f2a27]";

export default function StoreSettings() {
  const { user, loading } = useAuth();
  const utils = trpc.useUtils();
  const profile = trpc.storeAdmin.profile.useQuery(undefined, { enabled: user?.role === "admin" });
  const credentials = trpc.storeAdmin.credentials.useQuery(undefined, { enabled: user?.role === "admin" });
  const canProvision = trpc.storeAdmin.canProvision.useQuery(undefined, { enabled: user?.role === "admin" });
  const drafts = trpc.storeAdmin.drafts.useQuery(undefined, { enabled: canProvision.data === true });
  const save = trpc.storeAdmin.updateProfile.useMutation({ onSuccess: async () => {
    await utils.storeAdmin.profile.invalidate(); toast.success("Store settings saved");
  }, onError: error => toast.error(error.message) });
  const rotate = trpc.storeAdmin.rotateCredential.useMutation({ onSuccess: async data => {
    setOneTimeSecret({ type: data.credentialType, value: data.secret });
    await utils.storeAdmin.credentials.invalidate();
  }, onError: error => toast.error(error.message) });
  const provision = trpc.storeAdmin.createDraft.useMutation({ onSuccess: async data => {
    setOneTimeSecret({ type: "initial store credentials", value: `Staff: ${data.staffPassword}\nFrigate: ${data.frigateApiKey}` });
    await utils.storeAdmin.drafts.invalidate(); toast.success(`Store ${data.storeId} saved as inactive draft`);
  }, onError: error => toast.error(error.message) });
  const [form, setForm] = useState<Form>(emptyForm);
  const [oneTimeSecret, setOneTimeSecret] = useState<{ type: string; value: string } | null>(null);
  const [draft, setDraft] = useState({ ...emptyForm, timezone: "America/Mazatlan", cupSizes: "4oz, 8oz, Pint, Liter", ownerOpenId: "", ownerName: "" });

  useEffect(() => {
    if (!profile.data) return;
    setForm({
      nombre: profile.data.nombre, duenoEmail: profile.data.duenoEmail ?? "",
      horarioApertura: profile.data.horarioApertura ?? "", horarioCierre: profile.data.horarioCierre ?? "",
      posType: profile.data.posType,
    });
  }, [profile.data]);

  function input(label: string, value: string, onChange: (value: string) => void, type = "text") {
    return <label className="block text-sm font-medium text-[#44524e]">{label}
      <Input className="mt-1" type={type} value={value} onChange={event => onChange(event.target.value)} />
    </label>;
  }
  function posSelect(value: Form["posType"], onChange: (value: Form["posType"]) => void) {
    return <label className="block text-sm font-medium text-[#44524e]">Point of sale
      <select className={`${fieldClass} mt-1`} value={value} onChange={event => onChange(event.target.value as Form["posType"])}>
        {posOptions.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>;
  }

  return <DashboardLayout><main className="mx-auto max-w-4xl space-y-7 p-5 md:p-10">
    <div><h1 className="text-3xl font-semibold text-[#21312d]">Store settings</h1>
      <p className="mt-2 text-[#5c645e]">Manage your store and its access credentials.</p></div>
    {loading ? <p>Loading…</p> : user?.role !== "admin" ? <p>Manager access required.</p> : <>
      {profile.error && <p role="alert">{profile.error.message}</p>}
      {profile.data && <section className="space-y-5 rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold">{profile.data.nombre}</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {input("Store name", form.nombre, value => setForm({ ...form, nombre: value }))}
          {input("Owner email", form.duenoEmail, value => setForm({ ...form, duenoEmail: value }), "email")}
          {input("Opening (HH:mm)", form.horarioApertura, value => setForm({ ...form, horarioApertura: value }), "time")}
          {input("Closing (HH:mm)", form.horarioCierre, value => setForm({ ...form, horarioCierre: value }), "time")}
          {posSelect(form.posType, value => setForm({ ...form, posType: value }))}
        </div>
        <p className="text-sm text-[#5c645e]">Time zone: {profile.data.timezone}. Cup sizes: {profile.data.cupSizes.join(", ") || "legacy Ojala sizes"}.</p>
        <Button disabled={save.isPending} onClick={() => save.mutate({
          ...form, horarioApertura: form.horarioApertura || null, horarioCierre: form.horarioCierre || null,
        })}>Save settings</Button>
      </section>}
      <section className="space-y-4 rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold">Access credentials</h2>
        <p className="text-sm text-[#5c645e]">New secrets appear once. Rotating managed keys does not disable Ojala’s legacy environment keys.</p>
        <div className="flex flex-wrap gap-3">
          <Button disabled={rotate.isPending} onClick={() => rotate.mutate({ type: "staff_portal" })}>Rotate staff password</Button>
          <Button disabled={rotate.isPending} onClick={() => rotate.mutate({ type: "frigate" })}>Rotate Frigate key</Button>
        </div>
        <ul className="text-sm text-[#5c645e]">{credentials.data?.map(item => <li key={item.id}>
          {item.credentialType} · {item.label} · {item.revokedAt ? "Revoked" : "Active"}
        </li>)}</ul>
      </section>
      {canProvision.data && <section className="space-y-5 rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold">Prepare a new store</h2>
        <p className="text-sm text-[#5c645e]">This creates an inactive draft. Its owner and credentials cannot sign in or ingest data until operational rules are ready.</p>
        <div className="grid gap-4 md:grid-cols-2">
          {input("Store name", draft.nombre, value => setDraft({ ...draft, nombre: value }))}
          {input("Owner email", draft.duenoEmail, value => setDraft({ ...draft, duenoEmail: value }), "email")}
          {input("Owner OAuth Open ID", draft.ownerOpenId, value => setDraft({ ...draft, ownerOpenId: value }))}
          {input("Owner name", draft.ownerName, value => setDraft({ ...draft, ownerName: value }))}
          {input("IANA time zone", draft.timezone, value => setDraft({ ...draft, timezone: value }))}
          {input("Cup size labels (comma-separated)", draft.cupSizes, value => setDraft({ ...draft, cupSizes: value }))}
          {input("Opening (HH:mm)", draft.horarioApertura, value => setDraft({ ...draft, horarioApertura: value }), "time")}
          {input("Closing (HH:mm)", draft.horarioCierre, value => setDraft({ ...draft, horarioCierre: value }), "time")}
          {posSelect(draft.posType, value => setDraft({ ...draft, posType: value }))}
        </div>
        <Button disabled={provision.isPending} onClick={() => provision.mutate({
          ...draft, horarioApertura: draft.horarioApertura || null, horarioCierre: draft.horarioCierre || null,
          cupSizes: draft.cupSizes.split(",").map(size => size.trim()).filter(Boolean),
        })}>Create inactive draft</Button>
        <ul className="text-sm text-[#5c645e]">{drafts.data?.map(item => <li key={item.id}>#{item.id} · {item.nombre} · {item.timezone} · inactive</li>)}</ul>
      </section>}
      {oneTimeSecret && <section className="rounded-2xl border border-[#a04e36] bg-white p-6">
        <h2 className="text-lg font-semibold">Save this {oneTimeSecret.type} now</h2>
        <p className="text-sm">This value cannot be retrieved later.</p>
        <pre className="mt-3 whitespace-pre-wrap break-all rounded-lg bg-[#f8f3eb] p-4">{oneTimeSecret.value}</pre>
        <Button className="mt-3" onClick={() => setOneTimeSecret(null)}>Hide</Button>
      </section>}
    </>}
  </main></DashboardLayout>;
}
