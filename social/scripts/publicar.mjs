// Publica no Instagram os posts da fila (social/fila/<slug>/post.json) cujo horário já chegou.
// Usa a API oficial do Instagram (Instagram Login) — sem intermediário.
//
// Uso:
//   node social/scripts/publicar.mjs            publica o que estiver vencido
//   node social/scripts/publicar.mjs --dry-run  só valida a fila e mostra o que sairia
//   node social/scripts/publicar.mjs --forcar <slug>  publica esse post agora, ignorando horário
//
// Env: IG_ACCESS_TOKEN, IG_USER_ID (opcional, padrão "me"), SITE_URL, GRAPH_VERSION

import { readdir, readFile, writeFile, access } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const FILA = join(dirname(fileURLToPath(import.meta.url)), "..", "fila");
const SITE_URL = (process.env.SITE_URL || "https://www.studio215poa.com.br").replace(/\/$/, "");
const GRAPH = `https://graph.instagram.com/${process.env.GRAPH_VERSION || "v23.0"}`;
const IG_USER = process.env.IG_USER_ID || "me";
const TOKEN = process.env.IG_ACCESS_TOKEN;

// Post que atrasou mais que isso não sai sozinho — evita soltar um story velho
// depois de o agendador ter ficado parado. Com --forcar, sai mesmo assim.
const ATRASO_MAXIMO_MS = 24 * 60 * 60 * 1000;

const TIPOS = ["feed", "carrossel", "story", "reel"];
const IMAGEM = [".jpg", ".jpeg"];
const VIDEO = [".mp4", ".mov"];

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const FORCAR = args.includes("--forcar") ? args[args.indexOf("--forcar") + 1] : null;

async function existe(caminho) {
  try {
    await access(caminho);
    return true;
  } catch {
    return false;
  }
}

// Story de oferta relâmpago leva "requer_livre": {"inicio", "fim"} no post.json. Se a
// agenda do Airbnb (assets/agenda.json, atualizada aos 11 min de cada hora) já mostrar
// alguma dessas noites ocupada, o story não sai: não se anuncia data que já foi vendida.
const AGENDA = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "agenda.json");

async function dataVendida({ inicio, fim }) {
  if (!(await existe(AGENDA))) return false;
  const { ocupado = [] } = JSON.parse(await readFile(AGENDA, "utf8"));
  return ocupado.some((r) => r.inicio < fim && r.fim > inicio);
}

async function lerFila() {
  const pastas = (await readdir(FILA, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => d.name)
    .sort();

  const posts = [];
  for (const slug of pastas) {
    const dir = join(FILA, slug);
    if (!(await existe(join(dir, "post.json")))) continue;
    const post = JSON.parse(await readFile(join(dir, "post.json"), "utf8"));
    const publicado = await existe(join(dir, "publicado.json"));
    posts.push({ slug, dir, post, publicado });
  }
  return posts;
}

async function validar({ slug, dir, post }) {
  const erros = [];
  if (!TIPOS.includes(post.tipo)) erros.push(`tipo "${post.tipo}" inválido (use ${TIPOS.join(", ")})`);
  if (!post.publicar_em || Number.isNaN(Date.parse(post.publicar_em)))
    erros.push(`publicar_em ausente ou inválido — use ISO com fuso, ex. 2026-09-30T19:00:00-03:00`);
  else if (!/([+-]\d{2}:\d{2}|Z)$/.test(post.publicar_em))
    erros.push(`publicar_em sem fuso horário — acrescente -03:00`);
  if (!Array.isArray(post.midia) || post.midia.length === 0) erros.push("midia vazia");

  const midia = post.midia || [];
  for (const arquivo of midia) {
    if (!(await existe(join(dir, arquivo)))) erros.push(`arquivo não encontrado: ${arquivo}`);
    const ext = extname(arquivo).toLowerCase();
    if (post.tipo === "reel" && !VIDEO.includes(ext)) erros.push(`reel precisa de vídeo (.mp4/.mov): ${arquivo}`);
    if (post.tipo !== "reel" && ![...IMAGEM, ...VIDEO].includes(ext))
      erros.push(`formato não aceito pela API (só JPEG ou vídeo): ${arquivo}`);
    if (post.tipo === "feed" && !IMAGEM.includes(ext)) erros.push(`feed de imagem única precisa ser JPEG: ${arquivo}`);
  }
  if (post.tipo === "carrossel" && (midia.length < 2 || midia.length > 10))
    erros.push(`carrossel precisa de 2 a 10 arquivos (tem ${midia.length})`);
  if (["feed", "reel"].includes(post.tipo) && midia.length !== 1)
    erros.push(`${post.tipo} leva exatamente 1 arquivo (use "carrossel" para vários)`);
  if (post.tipo !== "story" && (post.legenda || "").length > 2200) erros.push("legenda passa de 2.200 caracteres");
  if (post.tipo === "story" && post.legenda) erros.push("story não tem legenda na API — remova o campo legenda");

  return erros.map((e) => `${slug}: ${e}`);
}

function urlPublica(slug, arquivo) {
  return `${SITE_URL}/social/fila/${encodeURIComponent(slug)}/${encodeURIComponent(arquivo)}`;
}

async function graph(metodo, caminho, params = {}) {
  const url = new URL(`${GRAPH}/${caminho}`);
  const corpo = new URLSearchParams({ ...params, access_token: TOKEN });
  const resp =
    metodo === "GET"
      ? await fetch(`${url}?${corpo}`)
      : await fetch(url, { method: "POST", body: corpo });
  const json = await resp.json();
  if (!resp.ok || json.error) {
    const msg = json.error ? `${json.error.message} (code ${json.error.code})` : resp.statusText;
    throw new Error(`${metodo} ${caminho}: ${msg}`);
  }
  return json;
}

// Vídeo (e às vezes carrossel) processa de forma assíncrona: só dá pra publicar em FINISHED.
async function esperarContainer(id) {
  for (let i = 0; i < 60; i++) {
    const { status_code } = await graph("GET", id, { fields: "status_code" });
    if (status_code === "FINISHED") return;
    if (status_code === "ERROR" || status_code === "EXPIRED") throw new Error(`container ${id} ficou ${status_code}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`container ${id} não terminou de processar em 5 minutos`);
}

function paramsDeMidia(arquivo) {
  const ext = extname(arquivo).toLowerCase();
  return VIDEO.includes(ext) ? { media_type: "VIDEO", video_url: arquivo } : { image_url: arquivo };
}

async function conferirUrls(urls) {
  for (const u of urls) {
    const resp = await fetch(u, { method: "HEAD" });
    if (!resp.ok) throw new Error(`${u} respondeu ${resp.status} — o GitHub Pages ainda não publicou a mídia?`);
  }
}

async function publicar({ slug, post }) {
  const urls = post.midia.map((a) => urlPublica(slug, a));
  await conferirUrls(urls);

  let containerId;
  if (post.tipo === "carrossel") {
    const filhos = [];
    for (const u of urls) {
      const p = paramsDeMidia(u);
      const { id } = await graph("POST", `${IG_USER}/media`, { ...p, is_carousel_item: "true" });
      await esperarContainer(id);
      filhos.push(id);
    }
    ({ id: containerId } = await graph("POST", `${IG_USER}/media`, {
      media_type: "CAROUSEL",
      children: filhos.join(","),
      caption: post.legenda || "",
    }));
  } else if (post.tipo === "reel") {
    ({ id: containerId } = await graph("POST", `${IG_USER}/media`, {
      media_type: "REELS",
      video_url: urls[0],
      caption: post.legenda || "",
    }));
  } else if (post.tipo === "story") {
    // Cada arquivo vira um story separado, na ordem da lista.
    const ids = [];
    for (const u of urls) {
      const p = paramsDeMidia(u);
      try {
        const { id } = await graph("POST", `${IG_USER}/media`, {
          media_type: "STORIES",
          ...(p.image_url ? { image_url: p.image_url } : { video_url: p.video_url }),
        });
        await esperarContainer(id);
        const { id: mediaId } = await graph("POST", `${IG_USER}/media_publish`, { creation_id: id });
        ids.push(mediaId);
      } catch (e) {
        // Parte dos stories já está no ar: não dá pra repetir o post inteiro sem duplicar.
        if (ids.length) throw Object.assign(e, { parcial: { media_ids: ids } });
        throw e;
      }
    }
    return { media_ids: ids };
  } else {
    ({ id: containerId } = await graph("POST", `${IG_USER}/media`, {
      image_url: urls[0],
      caption: post.legenda || "",
    }));
  }

  await esperarContainer(containerId);
  const { id: mediaId } = await graph("POST", `${IG_USER}/media_publish`, { creation_id: containerId });
  const { permalink } = await graph("GET", mediaId, { fields: "permalink" });
  return { media_ids: [mediaId], permalink };
}

async function main() {
  const posts = await lerFila();
  const agora = Date.now();

  const erros = (await Promise.all(posts.map(validar))).flat();
  if (erros.length) {
    console.error("Fila com problemas:\n  " + erros.join("\n  "));
    process.exit(1);
  }

  for (const p of posts)
    if (!p.publicado && p.post.requer_livre && (await dataVendida(p.post.requer_livre))) p.vendida = true;

  const vencidos = posts.filter(({ slug, post, publicado, vendida }) => {
    if (publicado) return false;
    if (FORCAR) return slug === FORCAR;
    if (post.aprovado !== true) return false;
    const quando = Date.parse(post.publicar_em);
    if (quando > agora) return false;
    if (vendida) {
      console.warn(`${slug}: as datas de ${post.requer_livre.inicio} a ${post.requer_livre.fim} já estão ocupadas — não publico.`);
      return false;
    }
    if (agora - quando > ATRASO_MAXIMO_MS) {
      console.warn(`${slug}: atrasado mais de 24h — não publico sozinho. Use --forcar ${slug} se ainda fizer sentido.`);
      return false;
    }
    return true;
  });

  if (FORCAR && vencidos.length === 0) {
    console.error(`--forcar ${FORCAR}: post não existe na fila ou já foi publicado.`);
    process.exit(1);
  }

  const pendentes = posts.filter((p) => !p.publicado && !vencidos.includes(p));
  for (const { slug, post } of pendentes)
    console.log(`aguardando  ${slug}  (${post.tipo}, ${post.publicar_em}${post.aprovado === true ? "" : ", NÃO aprovado"})`);

  if (vencidos.length === 0) {
    console.log("Nada para publicar agora.");
    return;
  }

  if (DRY_RUN) {
    for (const { slug, post } of vencidos)
      console.log(`sairia     ${slug}  (${post.tipo}) → ${post.midia.map((a) => urlPublica(slug, a)).join(", ")}`);
    return;
  }

  if (!TOKEN) throw new Error("IG_ACCESS_TOKEN não definido.");

  let falhou = false;
  for (const item of vencidos) {
    try {
      const resultado = await publicar(item);
      const registro = { publicado_em: new Date().toISOString(), ...resultado };
      await writeFile(join(item.dir, "publicado.json"), JSON.stringify(registro, null, 2) + "\n");
      console.log(`publicado  ${item.slug}  ${resultado.permalink || resultado.media_ids.join(", ")}`);
    } catch (e) {
      falhou = true;
      console.error(`FALHOU     ${item.slug}: ${e.message}`);
      if (e.parcial) {
        const registro = { publicado_em: new Date().toISOString(), parcial: true, erro: e.message, ...e.parcial };
        await writeFile(join(item.dir, "publicado.json"), JSON.stringify(registro, null, 2) + "\n");
        console.error(`           ${e.parcial.media_ids.length} story(s) já saíram — marcado como parcial, não repito.`);
      }
    }
  }
  if (falhou) process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
