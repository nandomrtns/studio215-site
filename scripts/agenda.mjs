// Lê o calendário exportado do Airbnb (secret AIRBNB_ICS_URL) e grava assets/agenda.json
// só com as datas: nada de nome, telefone ou link de reserva, porque o repositório é público.
// Uso: AIRBNB_ICS_URL=... node scripts/agenda.mjs
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const DESTINO = "assets/agenda.json";
const JANELA_DIAS = 380; // o calendário do site navega 12 meses
const OFERTA_ATE_DIAS = 21; // buraco que começa até aqui vira candidato a oferta relâmpago
const OFERTA_MIN_NOITES = 3;

const url = process.env.AIRBNB_ICS_URL;
if (!url) throw new Error("AIRBNB_ICS_URL não definido");

const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
if (!res.ok) throw new Error(`HTTP ${res.status} ao buscar o iCal do Airbnb`);
const ics = (await res.text()).replace(/\r?\n[ \t]/g, "");

const iso = (v) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
const somar = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

const ocupado = [];
for (const bloco of ics.split("BEGIN:VEVENT").slice(1)) {
  const ini = bloco.match(/DTSTART[^:]*:(\d{8})/);
  const fim = bloco.match(/DTEND[^:]*:(\d{8})/);
  if (ini && fim) ocupado.push({ inicio: iso(ini[1]), fim: iso(fim[1]) }); // fim = dia do checkout (exclusivo)
}
ocupado.sort((a, b) => a.inicio.localeCompare(b.inicio));

// Hoje no fuso de Porto Alegre.
const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const noites = new Set();
for (const r of ocupado) for (let d = r.inicio; d < r.fim; d = somar(d, 1)) noites.add(d);

// Sequências de noites livres a partir de hoje.
const livres = [];
let atual = null;
for (let i = 0; i < JANELA_DIAS; i++) {
  const d = somar(hoje, i);
  if (!noites.has(d)) { atual ??= { inicio: d, noites: 0 }; atual.noites++; }
  else if (atual) { livres.push({ ...atual, fim: somar(atual.inicio, atual.noites) }); atual = null; }
}
if (atual) livres.push({ ...atual, fim: somar(atual.inicio, atual.noites), aberto: true });

const limite = somar(hoje, OFERTA_ATE_DIAS);
const candidatos = livres.filter((l) => !l.aberto && l.inicio <= limite && l.noites >= OFERTA_MIN_NOITES);

const dados = { ocupado: ocupado.filter((r) => r.fim > hoje), livres_proximos: livres.slice(0, 12), oferta_relampago: candidatos };
const anterior = existsSync(DESTINO) ? JSON.parse(readFileSync(DESTINO, "utf8")) : {};
const { atualizado_em, ...semData } = anterior;
if (JSON.stringify(semData) === JSON.stringify(dados)) {
  console.log("agenda sem mudança");
} else {
  writeFileSync(DESTINO, JSON.stringify({ atualizado_em: new Date().toISOString(), ...dados }, null, 2) + "\n");
  console.log(`agenda atualizada: ${dados.ocupado.length} períodos ocupados, ${candidatos.length} candidato(s) a oferta`);
}
