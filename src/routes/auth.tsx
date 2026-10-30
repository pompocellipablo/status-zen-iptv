import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { isPanelOwner } from "@/lib/panel-access";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — MaxFlix" },
      { name: "description", content: "Acesso seguro ao painel MaxFlix." },
      { property: "og:title", content: "Entrar — MaxFlix" },
      { property: "og:description", content: "Acesso seguro ao painel MaxFlix." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void supabase.auth.getUser().then(async ({ data }) => {
      if (data.user && isPanelOwner(data.user.id)) void navigate({ to: "/", replace: true });
      else if (data.user) { await supabase.auth.signOut(); setMessage("Este painel é de acesso exclusivo ao proprietário."); }
    });
  }, [navigate]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setMessage("E-mail ou senha incorretos.");
    if (!isPanelOwner(data.user?.id)) {
      await supabase.auth.signOut();
      setMessage("Este painel é de acesso exclusivo ao proprietário.");
      return;
    }
    await navigate({ to: "/", replace: true });
  }

  async function enterWithGoogle() {
    setBusy(true);
    setMessage(null);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: `${window.location.origin}/auth`,
    });
    setBusy(false);
    if (result.error) setMessage("Não foi possível entrar com o Google.");
    else if (!result.redirected) await navigate({ to: "/", replace: true });
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 py-10 text-frost">
      <section className="w-full max-w-sm rounded-2xl bg-panel/90 p-6 ring-1 ring-line">
        <div className="flex flex-col items-center gap-2 text-center">
          <img src="/maxflix-logo.png" alt="Logo oficial MaxFlix" width={112} height={112}
            className="size-28 rounded-full object-cover drop-shadow-[0_0_12px_rgba(255,185,37,0.2)]" />
          <h1 className="font-display text-xl font-semibold">Max<span className="text-cyan">Flix</span></h1>
          <p className="text-xs text-mist">Acesso ao painel de clientes</p>
        </div>

        <p className="mt-6 text-sm text-mist">Acesso exclusivo ao proprietário.</p>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <label className="block text-xs text-mist">E-mail
            <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 w-full rounded-xl bg-background px-3 py-2.5 text-sm text-frost ring-1 ring-line outline-none focus:ring-cyan/50" />
          </label>
          <label className="block text-xs text-mist">Senha
            <input required minLength={6} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full rounded-xl bg-background px-3 py-2.5 text-sm text-frost ring-1 ring-line outline-none focus:ring-cyan/50" />
          </label>
          {message && <p className="rounded-xl bg-cyan/10 px-3 py-2 text-xs text-cyan ring-1 ring-cyan/30">{message}</p>}
          <button disabled={busy} type="submit" className="w-full rounded-xl bg-cyan px-4 py-2.5 text-sm font-semibold text-background disabled:opacity-60">{busy ? "Aguarde…" : "Entrar"}</button>
        </form>

        <div className="my-5 flex items-center gap-3 text-xs text-mist"><span className="h-px flex-1 bg-line" />ou<span className="h-px flex-1 bg-line" /></div>
        <button disabled={busy} onClick={enterWithGoogle} className="w-full rounded-xl bg-panel2 px-4 py-2.5 text-sm font-medium text-frost ring-1 ring-line disabled:opacity-60">Entrar com Google</button>
        <button onClick={() => void navigate({ to: "/esqueci-senha" })} className="mt-4 w-full text-center text-xs text-mist hover:text-cyan">Esqueci minha senha</button>
      </section>
    </main>
  );
}