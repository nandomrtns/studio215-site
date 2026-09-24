# Fila do Instagram (@studio215poa)

Publicação direta pela API oficial do Instagram, sem ferramenta intermediária.
O GitHub Actions confere esta fila de hora em hora e publica o que venceu.

## Como um post entra na fila

1. Criar `social/fila/AAAA-MM-DD-slug/` com as mídias e um `post.json`:

   ```json
   {
     "tipo": "carrossel",
     "publicar_em": "2026-09-30T19:00:00-03:00",
     "aprovado": true,
     "legenda": "…",
     "midia": ["1.jpg", "2.jpg", "3.jpg"]
   }
   ```

   - `tipo`: `feed` (1 JPEG), `carrossel` (2 a 10), `story` (cada arquivo vira um story, sem legenda) ou `reel` (1 vídeo).
   - `publicar_em`: sempre com fuso (`-03:00`).
   - `aprovado`: **só vira `true` depois do OK do Nando.** Sem isso o post nunca sai.
   - Mídia de imagem precisa ser **JPEG** — a API não aceita PNG.
   - `requer_livre` (opcional, para story de oferta relâmpago): `{"inicio": "AAAA-MM-DD", "fim": "AAAA-MM-DD"}`.
     Se `assets/agenda.json` já mostrar alguma dessas noites ocupada, o post não sai.

2. Commit + push no `main`. O GitHub Pages publica as mídias em
   `www.studio215poa.com.br/social/fila/…`, que é de onde o Instagram as busca.

Depois de publicado, o bot grava `publicado.json` na pasta (id e link do post) e o
post nunca é repetido. Posts atrasados mais de 24h não saem sozinhos.

**Atenção:** o repositório é público — o que está na fila fica visível no GitHub
antes de ir ao ar. Não colocar nada sigiloso aqui.

## Conferir antes de subir

```bash
node social/scripts/publicar.mjs --dry-run
```

## Publicar um post agora (teste)

Actions → "Publicar no Instagram" → Run workflow → preencher o slug.

## Secrets necessários

| secret | o que é |
|---|---|
| `IG_ACCESS_TOKEN` | token de longa duração do Instagram (60 dias, renovado todo dia 1º) |
| `IG_USER_ID` | id da conta profissional do @studio215poa |
| `GH_SECRETS_PAT` | token fino do GitHub com escrita em Secrets deste repo, usado só pra renovar o token |
