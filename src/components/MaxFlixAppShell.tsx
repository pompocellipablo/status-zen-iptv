import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  BarChart3, Coins, FileUp, Gift, Home, LogOut, Menu,
  MessageCircle, MessageSquare, RotateCcw, Server, Sparkles,
  Trophy, Truck, Tv,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet, SheetClose, SheetContent, SheetDescription,
  SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";

/**
 * The authenticated app shell persists when moving between pages.
 * Home-only panels are opened from any page without copying their logic
 * into every section; their data remains controlled by the original home page.
 */
export type HomePanelAction = "pontos" | "mensagem" | "importar" | "previsao" | "servidores";

type NavigationContextValue = {
  pendingAction: HomePanelAction | null;
  clearPendingAction: () => void;
};

const NavigationContext = createContext<NavigationContextValue | null>(null);

export function useMaxFlixNavigationAction(): NavigationContextValue {
  const navigation = useContext(NavigationContext);
  if (!navigation) throw new Error("MaxFlix navigation is only available on authenticated pages.");
  return navigation;
}

const itemClass =
  "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-frost hover:bg-frost/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan";
const iconClass = "shrink-0 text-cyan";

export function MaxFlixAppShell({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<HomePanelAction | null>(null);
  const clearPendingAction = useCallback(() => setPendingAction(null), []);
  const value = useMemo(() => ({ pendingAction, clearPendingAction }), [pendingAction, clearPendingAction]);

  const runHomeAction = (action: HomePanelAction) => {
    setOpen(false);
    setPendingAction(action);
    void navigate({ to: "/" });
  };
  const signOut = async () => {
    setOpen(false);
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    await navigate({ to: "/auth", replace: true });
  };

  return (
    <NavigationContext.Provider value={value}>
      <div className="min-h-screen bg-background text-frost">
        <header className="sticky top-0 z-30 border-b border-line/60 bg-background/95 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <Link to="/" className="flex min-w-0 items-center gap-3" aria-label="MaxFlix — ir ao painel principal">
              <img src="/maxflix-logo.png" alt="" width={44} height={44}
                className="size-11 shrink-0 rounded-full object-cover drop-shadow-[0_0_6px_rgba(249,174,44,0.25)]" />
              <div className="min-w-0 leading-none">
                <p className="truncate font-display text-lg font-semibold">
                  Max<span className="text-cyan">Flix</span>
                </p>
                <p className="mt-1 text-[11px] tracking-wide text-mist">Gestão de clientes IPTV</p>
              </div>
            </Link>

            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <button type="button" aria-label="Abrir menu de navegação MaxFlix" title="Menu MaxFlix"
                  className="grid size-11 shrink-0 place-items-center rounded-xl bg-panel text-frost ring-1 ring-line transition-colors hover:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
                  <Menu size={23} aria-hidden="true" />
                </button>
              </SheetTrigger>

              <SheetContent side="right"
                className="flex h-full w-[min(360px,92vw)] flex-col overflow-hidden border-line bg-panel2 p-0 text-frost sm:max-w-[360px]">
                <SheetHeader className="shrink-0 border-b border-line px-5 py-5 pr-12 text-left">
                  <div className="flex items-center gap-3">
                    <img src="/maxflix-logo.png" alt="Logo MaxFlix" width={60} height={60}
                      className="size-[60px] shrink-0 rounded-full object-cover" />
                    <div className="min-w-0">
                      <SheetTitle className="font-display text-xl font-bold text-frost">
                        Max<span className="text-cyan">Flix</span>
                      </SheetTitle>
                      <SheetDescription className="mt-1 text-xs text-mist">
                        Ferramentas de gestão
                      </SheetDescription>
                    </div>
                  </div>
                </SheetHeader>

                <nav aria-label="Menu principal MaxFlix" className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
                  <div className="space-y-1">
                    <p className="px-3 pb-1 text-[11px] font-bold uppercase tracking-widest text-cyan/80">
                      Gestão de clientes
                    </p>
                    <SheetClose asChild>
                      <Link to="/" className={itemClass}>
                        <Home size={18} className={iconClass} aria-hidden="true" /> Visão geral
                      </Link>
                    </SheetClose>
                    <SheetClose asChild>
                      <Link to="/indicacoes" className={itemClass}>
                        <Trophy size={18} className={iconClass} aria-hidden="true" /> Indicações e Ranking
                      </Link>
                    </SheetClose>
                    <button type="button" onClick={() => runHomeAction("pontos")} className={itemClass}>
                      <Gift size={18} className={iconClass} aria-hidden="true" /> Pontos e prêmios
                    </button>
                    <SheetClose asChild>
                      <Link to="/recuperacao" className={itemClass}>
                        <RotateCcw size={18} className={iconClass} aria-hidden="true" /> Recuperação de clientes
                      </Link>
                    </SheetClose>
                    <button type="button" onClick={() => runHomeAction("mensagem")} className={itemClass}>
                      <MessageSquare size={18} className={iconClass} aria-hidden="true" /> Mensagem de cobrança
                    </button>
                    <button type="button" onClick={() => runHomeAction("importar")} className={itemClass}>
                      <FileUp size={18} className={iconClass} aria-hidden="true" /> Importar clientes
                    </button>
                  </div>

                  <div className="space-y-1 border-t border-line pt-4">
                    <p className="px-3 pb-1 text-[11px] font-bold uppercase tracking-widest text-cyan/80">
                      Financeiro e servidores
                    </p>
                    <SheetClose asChild>
                      <Link to="/creditos" className={itemClass}>
                        <Coins size={18} className={iconClass} aria-hidden="true" /> Créditos
                      </Link>
                    </SheetClose>
                    <SheetClose asChild>
                      <Link to="/revendedores" className={itemClass}>
                        <Truck size={18} className={iconClass} aria-hidden="true" /> Revendedores
                      </Link>
                    </SheetClose>
                    <SheetClose asChild>
                      <Link to="/aparelhos" className={itemClass}>
                        <Tv size={18} className={iconClass} aria-hidden="true" /> Vendas de TV Box
                      </Link>
                    </SheetClose>
                    <button type="button" onClick={() => runHomeAction("previsao")} className={itemClass}>
                      <BarChart3 size={18} className={iconClass} aria-hidden="true" /> Previsão de lucro
                    </button>
                    <button type="button" onClick={() => runHomeAction("servidores")} className={itemClass}>
                      <Server size={18} className={iconClass} aria-hidden="true" /> Relatório de servidores
                    </button>
                  </div>

                  <div className="space-y-1 border-t border-line pt-4">
                    <p className="px-3 pb-1 text-[11px] font-bold uppercase tracking-widest text-cyan/80">
                      Marketing e comunicação
                    </p>
                    <SheetClose asChild>
                      <Link to="/marketing" className={itemClass}>
                        <Sparkles size={18} className={iconClass} aria-hidden="true" /> Marketing IA
                      </Link>
                    </SheetClose>
                    <SheetClose asChild>
                      <Link to="/comunicacao" className={itemClass}>
                        <MessageCircle size={18} className={iconClass} aria-hidden="true" /> Comunicação
                      </Link>
                    </SheetClose>
                  </div>
                </nav>
                <div className="shrink-0 border-t border-line bg-panel px-4 py-3">
                  <button type="button" onClick={() => void signOut()}
                    className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-mist hover:bg-danger/10 hover:text-danger">
                    <LogOut size={18} aria-hidden="true" /> Sair da conta
                  </button>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </header>
        {children}
      </div>
    </NavigationContext.Provider>
  );
}
