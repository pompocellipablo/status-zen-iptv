/**
 * Painel Recarga API adapter (04/11/2026, api.pdf).
 * No tokens or panel credentials are ever handled by the browser.
 * MaxFlix renews server credit one cycle at a time, including prepaid packages.
 */
export const RECARGA_BASE_URL = "https://painelrecarga.dev";
export type PanelRoute = {kind: "iptv" | "p2p"; panel: string; path: string};
const IPTV_PANELS: Record<string,string> = {
  "All Play":"allplay", "Club":"club",
  "Five":"five", "Now":"now", "Uniplay":"uniplay",
};

/**
 * "UniP2P" is the Uniplay P2P panel (confirmed by the MaxFlix owner).
 * It must not go through the distinct Uniplay IPTV endpoint.
 */
export function panelRouteForClient(server: string):PanelRoute|null {
  if(server==="UniP2P")
    return {kind:"p2p",panel:"uniplay",path:"/renovar/p2p/uniplay"};
  // All currently registered Blade customers use Blade P2P, not Blade IPTV.
  if(server==="Blade")
    return {kind:"p2p",panel:"blade",path:"/renovar/p2p/blade"};
  const name=IPTV_PANELS[server];
  if(!name)return null;
  return {kind:"iptv",panel:name,path:"/renovar/iptv/"+name};
}

/**
 * Preserve coverage already paid in MaxFlix. Never convert a monthly server
 * renewal into a second payment, or shift the financial date of a package.
 */
export function financialTransitionError(
  client: {due_date:string;financial_due_date:string|null},
  values: {months:number;dueDate:string;financialDueDate:string;paymentAmount:number;monthlyPaid:number;paymentCost:number},
):string|null {
  const previousFinancial=client.financial_due_date??client.due_date;
  if(previousFinancial<client.due_date)
    return "Vencimento financeiro anterior ao técnico: conciliação manual necessária.";
  if(previousFinancial>client.due_date){
    if(values.financialDueDate!==previousFinancial)
      return "Pacote já pago: o vencimento financeiro precisa ser preservado.";
    if(values.dueDate>previousFinancial)
      return "O próximo ciclo ultrapassa a cobertura paga; revise o novo pagamento manualmente.";
    if(values.paymentAmount!==0 || values.monthlyPaid!==0 || values.paymentCost!==0)
      return "Pacote já pago: não registrar outra cobrança nesta renovação.";
  }else if(values.months===1 && values.financialDueDate!==values.dueDate){
    return "Plano mensal: os vencimentos técnico e financeiro precisam avançar juntos.";
  }
  return null;
}

export function buildPanelRecargaBody(login:string,simulate:boolean):{
  usuario:string;ciclos:1;simular?:true
} {
  if(!login || !login.trim() || login.length>160)throw Error("Login ausente ou inválido.");
  return simulate
    ? {usuario:login,ciclos:1,simular:true}
    : {usuario:login,ciclos:1};
}

export type ExternalRenewalState="confirmed"|"simulated"|"waiting"|"uncertain"|"failed";
export type ExternalOutcome={
  status:ExternalRenewalState;
  message:string;
  orderId?:string;
  previousDue?:string;
  nextDue?:string;
  candidates?:string[];
};

/**
 * Never infer success from HTTP 200 alone. The API can answer 202 (queued),
 * 207 (mixed batch), or mark a result as incerto. A simulated request is
 * NEVER confirmation of renewal.
 */
export function parsePanelRecargaResponse(
  httpStatus:number,data:unknown,expectedLogin:string,simulated=false,
):ExternalOutcome {
  if(typeof data!=="object"||data===null||Array.isArray(data))
    return {status:"uncertain",message:"Resposta não reconhecida; confira o pedido no painel."};
  const root=data as Record<string,unknown>;
  const orderId=typeof root["pedido_id"]==="string"?root["pedido_id"]:undefined;
  const results=Array.isArray(root["resultados"])?root["resultados"]:[];
  const row=results.length===1&&typeof results[0]==="object"&&results[0]!==null
    ? results[0] as Record<string,unknown> : null;
  const id=(row&&typeof row["pedido_id"]==="string"?row["pedido_id"]:orderId);
  const base={...(id?{orderId:id}:{})};
  if(httpStatus===202||root["precisa_login"]===true||root["aguardando_sessao"])
    return {...base,status:"waiting",message:"Pedido aguardando sessão ou confirmação no painel; não atualizar a MaxFlix."};
  if(row?.["incerto"]===true||root["incerto"]===true)
    return {...base,status:"uncertain",message:"Painel não confirmou o resultado. Verifique antes de tentar novamente."};
  if(simulated) {
    if(httpStatus===200 && root["ok"]===true && row?.["ok"]===true && row["usuario"]===expectedLogin){
      // The documented "vencimento_antes" may be omitted in simulations.
      // Never mistake vencimento_novo (projected post-renewal) for the current expiry.
      // Only expose a real, validated date bound to the *exact* matched login.
      const before=typeof row["vencimento_antes"]==="string"?row["vencimento_antes"]:undefined;
      const verified=panelDateToISO(before);
      return {...base,status:"simulated",
        message:"Usuário localizado na simulação; nenhum crédito foi consumido.",
        ...(verified?{previousDue:verified}:{}),
      };
    }
    return {...base,status:"failed",message:typeof root["erro"]==="string"?root["erro"]:"A simulação não confirmou o login exato."};
  }
  if(httpStatus===207)
    return {...base,status:"uncertain",message:"Resposta parcial (207); verifique cada item antes de atualizar a MaxFlix."};
  if(httpStatus>=500||httpStatus===408||httpStatus===429)
    return {...base,status:"uncertain",message:"Falha ou indisponibilidade do servidor; consulte o mesmo pedido."};
  if(httpStatus!==200){
    const err=typeof root["erro"]==="string"?root["erro"]:"Pedido não confirmado pelo painel.";
    const candidates=Array.isArray(row?.["candidatos"])?(row["candidatos"] as unknown[]).filter((c):c is string=>typeof c==="string").slice(0,8):undefined;
    return {...base,status:"failed",message:err,...(candidates?{candidates}:{})};
  }
  const loginExact=row?.["usuario"]===expectedLogin;
  if(root["ok"]===true && row?.["ok"]===true && loginExact && row?.["incerto"]!==true
    && (typeof row["ciclos_feitos"]!=="number"||row["ciclos_feitos"]>=1)){
    return {
      ...base,status:"confirmed",message:"Renovação confirmada pelo painel externo.",
      ...(typeof row["vencimento_antes"]==="string"?{previousDue:row["vencimento_antes"]}:{}),
      ...(typeof row["vencimento_novo"]==="string"?{nextDue:row["vencimento_novo"]}:{}),
    };
  }
  if(root["ok"]===false && row?.["incerto"]!==true){
    return {...base,status:"failed",message:typeof root["erro"]==="string"?root["erro"]:typeof row?.["erro"]==="string"?row["erro"]:"Renovação recusada pelo painel."};
  }
  return {...base,status:"uncertain",message:"Resposta não confirma o login exato e o sucesso da renovação."};
}

export function isExternalSyncSafe(response:ExternalOutcome):boolean {
  return response.status==="confirmed";
}

/** Provider dates in the PDF are dd/MM/yyyy HH:mm:ss; no timezone assumption. */
export function panelDateToISO(value:string | undefined):string|null{
  if(!value)return null;
  const br=value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s|$)/);
  const iso=value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:T|\s|$)/);
  if(!br&&!iso)return null;
  const y=br?br[3]!:iso![1]!,m=br?br[2]!:iso![2]!,d=br?br[1]!:iso![3]!;
  const check=new Date(Date.UTC(Number(y),Number(m)-1,Number(d)));
  if(check.getUTCFullYear()!==Number(y)||check.getUTCMonth()+1!==Number(m)||check.getUTCDate()!==Number(d))return null;
  return y+"-"+m+"-"+d;
}
