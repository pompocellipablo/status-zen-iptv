import { getStatus, type Client } from "./iptv";

/** Read-only comparison of a manually exported server user list with MaxFlix. */
export type PanelAccount = {
  login: string;
  status: "active" | "inactive" | "unknown";
  expires: string | null;
};
export type PanelAuditRow = { login: string; client?: Client; account?: PanelAccount };
export type PanelAuditResult = {
  panelOnly: PanelAuditRow[];
  maxflixOnly: PanelAuditRow[];
  statusDifferences: PanelAuditRow[];
  dateDifferences: PanelAuditRow[];
  matching: number;
  duplicatePanel: string[];
  duplicateMaxflix: string[];
};
export type ParsedPanelExport = {
  accounts: PanelAccount[];
  ignored: number;
  hadRecognizedHeader: boolean;
  hasStatus: boolean;
  hasExpiry: boolean;
};

export function normalizeAccountLogin(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("pt-BR");
}
function canonicalHeader(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}
function splitCsvLine(line: string, separator: string): string[] {
  const fields: string[] = [];
  let value = "";
  let quote = false;
  for(let i = 0; i < line.length; i++) {
    const ch = line[i];
    if(ch === '"') {
      if(quote && line[i+1] === '"') {value += '"'; i++;}
      else quote = !quote;
    } else if(ch === separator && !quote) {
      fields.push(value.trim()); value="";
    } else value += ch;
  }
  fields.push(value.trim());
  return fields;
}
function statusFrom(value: string): PanelAccount["status"] {
  const s=canonicalHeader(value);
  if(["ativo","active","enabled","valid","habilitado","liberado","1","true","sim"].includes(s)) return "active";
  if(["inativo","inactive","disabled","expired","expirado","vencido","bloqueado","blocked","0","false","nao"].includes(s)) return "inactive";
  return "unknown"; // "offline" is a connection state, not necessarily an expired account
}
export function isoPanelDate(input: string): string | null {
  const value = input.trim();
  if(!value) return null;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if(iso) return validDate(iso[1]!,iso[2]!,iso[3]!);
  const br = value.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s.*)?$/);
  if(br) return validDate(br[3]!,br[2]!,br[1]!);
  return null;
}
function validDate(y:string,m:string,d:string):string|null {
  const date=new Date(Date.UTC(Number(y),Number(m)-1,Number(d)));
  if(date.getUTCFullYear()!==Number(y)||date.getUTCMonth()+1!==Number(m)||date.getUTCDate()!==Number(d))return null;
  return y+"-"+m+"-"+d;
}
const loginHeaders = ["login","usuario","username","user","userlogin","account","conta"];
const statusHeaders = ["status","situacao","estado","state"];
const expiresHeaders = ["expiration","expire","expiracao","vencimento","validade","expires","expdate","expirydate","expiredate","dataexpiracao","datavencimento"];

/**
 * Supports CSV (comma, semicolon or tab) with a login header, or TXT containing
 * one login per line. Text never leaves the browser and is not stored.
 */
export function parsePanelExport(text: string): ParsedPanelExport {
  const lines=text.replace(/^\uFEFF/,"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(!lines.length) return {accounts:[],ignored:0,hadRecognizedHeader:false,hasStatus:false,hasExpiry:false};
  const header=lines[0]!;
  const separator=[";","\t",","].sort((a,b)=>splitCsvLine(header,b).length-splitCsvLine(header,a).length)[0]!;
  const first=splitCsvLine(header,separator).map(canonicalHeader);
  const loginIndex=first.findIndex(h=>loginHeaders.includes(h));
  const recognizedHeader=loginIndex>=0;
  const hasDelimitedColumns=first.length>1;
  const statusIndex=recognizedHeader?first.findIndex(h=>statusHeaders.includes(h)):(hasDelimitedColumns?1:-1);
  const expiresIndex=recognizedHeader?first.findIndex(h=>expiresHeaders.includes(h)):(hasDelimitedColumns&&first.length>2?2:-1);
  // Never treat an unidentified CSV heading as a username.
  if(!recognizedHeader && hasDelimitedColumns && first.some(h=>["id","name","nome","email"].includes(h))) {
    return {accounts:[],ignored:lines.length,hadRecognizedHeader:false,hasStatus:false,hasExpiry:false};
  }
  const accounts:PanelAccount[]=[];
  let ignored=0;
  for(const line of (recognizedHeader?lines.slice(1):lines)){
    const fields=splitCsvLine(line,separator);
    const raw=(fields[recognizedHeader?loginIndex:0]??"").trim();
    if(!raw || raw.startsWith("#")){ignored++;continue;}
    const login=raw.replace(/^["']|["']$/g,"").trim();
    if(!login || login.length>128){ignored++;continue;}
    accounts.push({
      login,
      status: statusIndex>=0?statusFrom(fields[statusIndex]??""):"unknown",
      expires: expiresIndex>=0?isoPanelDate(fields[expiresIndex]??""):null,
    });
  }
  return {accounts,ignored,hadRecognizedHeader:recognizedHeader,
    hasStatus:accounts.some(a=>a.status!=="unknown"),hasExpiry:accounts.some(a=>a.expires!==null)};
}
export function auditServerAccounts(clients: readonly Client[], exported: readonly PanelAccount[]):PanelAuditResult {
  const apps=new Map<string,Client[]>();
  const panel=new Map<string,PanelAccount[]>();
  for(const client of clients){
    const key=normalizeAccountLogin(client.login);
    if(key)apps.set(key,[...(apps.get(key)??[]),client]);
  }
  for(const account of exported){
    const key=normalizeAccountLogin(account.login);
    if(key)panel.set(key,[...(panel.get(key)??[]),account]);
  }
  const res:PanelAuditResult={panelOnly:[],maxflixOnly:[],statusDifferences:[],dateDifferences:[],matching:0,duplicatePanel:[],duplicateMaxflix:[]};
  for(const [key,accs] of panel){
    const a=accs[0];
    if(!a)continue;
    if(accs.length>1){res.duplicatePanel.push(a.login);continue;}
    const client=apps.get(key);
    if(!client){res.panelOnly.push({login:a.login,account:a});continue;}
    if(client.length>1)continue;
    const c=client[0];
    if(!c)continue;
    const active=getStatus(c).key!=="vencido";
    if((a.status==="active"&&!active)||(a.status==="inactive"&&active)) res.statusDifferences.push({login:c.login,client:c,account:a});
    else if(a.expires && a.expires!==c.due_date) res.dateDifferences.push({login:c.login,client:c,account:a});
    else res.matching++;
  }
  for(const [key,records] of apps){
    const c=records[0];
    if(!c)continue;
    if(records.length>1){res.duplicateMaxflix.push(c.login);continue;}
    if(!panel.has(key))res.maxflixOnly.push({login:c.login,client:c});
  }
  return res;
}
