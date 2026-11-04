# NOVA — Consulta de Estoque (celular)

Versão do NOVA que roda direto no navegador do celular, sem precisar do computador ligado.
O celular consulta o Protheus pela internet (HTTPS), em qualquer rede: Wi-Fi 4K-CD, outra rede ou dados móveis.

## Como publicar no GitHub Pages (uma vez só)
1. Crie uma conta em https://github.com (gratuita) e entre.
2. Clique em **+** (canto superior direito) → **New repository**.
   - Repository name: `nova` (ou outro nome)
   - Marque **Public** (o GitHub Pages gratuito exige repositório público)
   - Clique em **Create repository**.
3. Na página do repositório, clique em **uploading an existing file** (ou **Add file → Upload files**).
4. Arraste **todos os arquivos desta pasta** (não a pasta em si: os arquivos de dentro, incluindo `.nojekyll`) e clique em **Commit changes**.
5. Vá em **Settings → Pages**. Em *Build and deployment*: Source = **Deploy from a branch**, Branch = **main** / **(root)** → **Save**.
6. Espere 1–2 minutos e recarregue a página de Settings → Pages: aparece o endereço, ex.: `https://SEU-USUARIO.github.io/nova/`.

## No celular
1. Abra o endereço no Safari (iPhone) ou Chrome (Android).
2. Entre com usuário e senha do Protheus e marque **Mantenha-me conectado** (30 dias neste aparelho).
3. Vire app: iPhone → Compartilhar → **Adicionar à Tela de Início**; Android → ⋮ → **Instalar app** / **Adicionar à tela inicial**.

## Como funciona nesta versão
- Mesmas telas e regras do NOVA do computador: grupos por OP/Partida, prioridade (armazém 93 / AM01 / AM02, aprovado para amostra, CMC, entrada), punhos por OP, gramatura ideal da SBM (BM_GRAMTIN).
- **Defeitos e regras de gramatura ficam guardados no próprio aparelho.** Para levar os defeitos do computador para o celular: no NOVA do computador, copie o arquivo `dados/MALHAS_RUINS.csv` para o celular (e-mail, WhatsApp, OneDrive…) e, no celular, abra um grupo → **Indicar defeito → Importar planilha**. **Baixar planilha** exporta os defeitos do celular.
- "Mantenha-me conectado" guarda o acesso **neste navegador** por 30 dias. Use só no seu celular e toque em **Sair** se emprestar o aparelho.

## Atualizar
Envie de novo os arquivos alterados em **Add file → Upload files** (substituindo os antigos). O app no celular pega a versão nova ao abrir com internet.

## Endereço do Protheus
Fica em `config.js`. Se não quiser o endereço da empresa visível no repositório público, troque por `apiUrl: ''`: o NOVA passa a pedir o endereço no primeiro login (`https://protheus.quatroktextil.com.br:6632/rest05`) e guarda no aparelho.

## Requisito no Protheus
O REST precisa permitir CORS (já está: `Access-Control-Allow-Origin: *`). Se um dia o TI desligar, o celular passa a mostrar "Não foi possível falar com o Protheus".
