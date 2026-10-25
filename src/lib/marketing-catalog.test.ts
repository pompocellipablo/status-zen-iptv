import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMarketingTitle, parseMarketingM3U } from "./marketing-catalog";

describe("Marketing IA — importador",()=>{
  const sample = [
    "#EXTM3U",
    '#EXTINF:-1 tvg-name="Toy Story 5 (2026)" group-title="Filmes",Toy Story 5 (2026)',
    "http://example.test/movie/user/password/10.mkv",
    '#EXTINF:-1 tvg-name="Ted Lasso S01E01" group-title="Séries",Ted Lasso S01E01',
    "http://example.test/series/user/password/1.mp4",
    '#EXTINF:-1 tvg-name="Ted Lasso S01E02" group-title="Séries",Ted Lasso S01E02',
    "http://example.test/series/user/password/2.mp4",
    '#EXTINF:-1 tvg-name="Canal Futebol" group-title="Esportes",Canal Futebol',
    "http://example.test/live/user/password/20.ts",
  ].join("\n");

  test("identifica filme e série, unifica episódios e ignora canais",()=>{
    const parsed = parseMarketingM3U(sample,"Five");
    assert.equal(parsed.entries.length,2);
    assert.ok(parsed.entries.find(x=>x.title==="Ted Lasso"&&x.kind==="serie"));
    assert.ok(parsed.entries.find(x=>x.title==="Toy Story 5"&&x.release_year===2026));
  });
  test("nunca devolve as URLs ou credenciais de reprodução",()=>{
    const parsed = parseMarketingM3U(sample,"Five");
    assert.equal(JSON.stringify(parsed).includes("password"),false);
    assert.equal(JSON.stringify(parsed).includes("example.test"),false);
  });
  test("conteúdos iguais de servidores diferentes recebem a mesma chave",()=>{
    const first=parseMarketingM3U(sample,"GF").entries;
    const second=parseMarketingM3U(sample,"Club").entries;
    assert.deepEqual(first.map(x=>x.content_key),second.map(x=>x.content_key));
  });
  test("normalização respeita tipo e ano",()=>{
    assert.equal(normalizeMarketingTitle("Toy Story 5 (2026)","filme")?.content_key,"filme:toy-story-5:2026");
    assert.equal(normalizeMarketingTitle("Ted Lasso S03E08","serie")?.content_key,
      normalizeMarketingTitle("Ted Lasso S01E01","serie")?.content_key);
  });
});