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

## Pesquisar por código ou por nome
No campo de pesquisa dá para digitar o **código** (12 caracteres) ou o **nome do artigo** (ex.: `meia malha pent`). A partir de 3 letras o NOVA mostra uma lista com código e descrição: primeiro o que já foi pesquisado ou salvo em pastas neste aparelho, depois o cadastro de produtos do Protheus (SB1), pelo começo do código ou pelas palavras do nome, em qualquer ordem. Tocar numa sugestão já faz a pesquisa. Com um único resultado, **Pesquisar** (ou Enter) abre direto. O mesmo vale para o campo do topo na tela de resultado.

O **relatório de estoque** (🖨 Imprimir relatório) sai com a logo do Grupo Quatro K no cabeçalho de todas as páginas.

## Pastas (separação de rolos)
1. Toque em **📁 Pastas**, dê um nome (ex.: `cartela`) e **Criar pasta**. A pasta fica **ativa** e o NOVA pergunta "Qual código deseja procurar?".
2. Pesquise o código, abra a OP (**Exibir mais**) e toque em **💾 Salvar em cartela** (à esquerda de Indicar defeito). Salva a OP com todos os rolos; quando a OP está em mais de um endereço, eles ficam juntos, ex.: `08196 - 01023 - 04106`. Tocar de novo numa OP já salva permite atualizar os rolos ou tirar da pasta.
3. Para buscar: **📁 Pastas → cartela**. Cada OP mostra os endereços e os rolos com uma caixinha: marque conforme for pegando (riscado em verde). **A pegar / Todos / Pegos** filtram a lista; a barra mostra o progresso.
4. **Coleta e baixa do RG**: em **A pegar**, abra a OP e toque no RG que coletou → confirme (os **outros RGs dessa OP são apagados da pasta** e fica só o coletado); o RG vai para a aba **Pegas**. Em **Pegas**, toque em qualquer parte da linha da OP → confira o produto e digite o **peso para baixa** e o **MC**, só com números, que entram como centésimos (8 = 0,08 · 80 = 0,80 · 180 = 1,80 · 1875 = 18,75; para zerar o MC, digite 0). Com o peso, a OP sai de **Pegas** e o RG aparece em **Baixas**. Na mesma tela, **↩ Não peguei** desfaz a coleta: o RG volta para *A pegar* e o NOVA busca no estoque os outros RGs da OP. Os valores ficam na planilha da equipe (colunas `peso_baixa` e `mc`).
5. **Baixas** (aba dentro da pasta): mostra só os RGs pegos que têm **Peso Total** para baixar (RG, produto/descrição, **armazém**, peso e MC), em ordem alfabética. O armazém (01 ou 93) aparece antes do peso e do MC, também na folha impressa e na lista copiada; em OPs salvas por versões antigas, sem armazém gravado, aparece —. A caixinha ☐ marca **baixa efetuada**: pede confirmação e, confirmado, o RG **sai da pasta** (para todos, com a planilha conectada); se a OP ficar sem RG, ela também sai. **🖨 Imprimir** gera a folha com a logo do Grupo Quatro K (RG em cima, descrição e código do produto embaixo, peso e MC), em **retrato ou paisagem**, com **1 ou 2 colunas** (no *Automático*, quando são muitos RGs, divide a folha em 2 colunas e diminui a letra para caber tudo numa página; a tela avisa quantas páginas vai dar); **📋 Copiar lista** copia em texto. Cada linha mostra o RG com a descrição e o código embaixo; tocar em qualquer parte da linha (menos na caixinha e no botão de copiar) abre a correção do peso, e o botão **⧉** no fim da linha copia só o RG (para colar no Protheus).
6. **🧹 Limpar** (dentro da pasta): tira só as OPs já pegas ou esvazia a pasta inteira, sem excluir a pasta. Com a planilha conectada, vale para todos (funciona melhor com o `PLANILHA_PASTAS_Code.gs` atualizado; com o script antigo, o NOVA tira uma OP por vez).
7. Com a **Planilha Google** conectada (abaixo), as pastas são **compartilhadas** entre todos os usuários; sem ela, ficam só no aparelho. **Exportar/Importar planilha** (CSV) continua disponível.

## Pastas compartilhadas (Planilha Google) — configurar uma vez
Sem isso, cada aparelho tem as suas pastas. Com isso, **todos os usuários e aparelhos veem as mesmas pastas e o mesmo "peguei"** (a lista se atualiza sozinha a cada 20 s).
1. Entre em https://sheets.google.com com uma conta Google e crie uma **planilha em branco** (ex.: `NOVA Pastas`).
2. Menu **Extensões → Apps Script**. Apague o que estiver no editor e cole todo o arquivo **`PLANILHA_PASTAS_Code.gs`**.
3. Na linha `const CHAVE = 'TROQUE-ESTA-CHAVE';` troque pelo **código da equipe** (ex.: `'quatrok-cd-2026'`). Clique no disquete (Salvar).
4. **Implantar → Nova implantação** → engrenagem ⚙ → **App da Web**. *Executar como:* **Eu**; *Quem pode acessar:* **Qualquer pessoa** → **Implantar** → autorize com a conta Google (se aparecer "app não verificado": *Avançado → Acessar*). Copie o **URL do app da Web** (termina em `/exec`).
5. Em cada aparelho: **📁 Pastas** → cole o URL e o código da equipe → **Conectar**. (Se o URL for colocado no `config.js`, em `pastasUrl`, cada aparelho só digita o código.)
6. Pastas que já estavam só num aparelho: depois de conectar, toque em **⇪ Enviar pastas deste aparelho para a planilha**.
- As abas **Pastas**, **Rolos** e **Defeitos** são criadas sozinhas na planilha (dá para olhar e filtrar; não apague colunas nem a linha 1).
- **Malhas com defeito também são compartilhadas**: com a planilha conectada, o que um usuário marca em ⚠ Indicar defeito aparece em vermelho para todos (aba Defeitos). Defeitos que estavam só no aparelho/computador: abra ⚠ Indicar defeito e toque em **⇪ Enviar defeitos deste aparelho para a planilha**.
- **Atualizar o script** (quando vier versão nova): Apps Script → apague tudo → cole o novo `PLANILHA_PASTAS_Code.gs` → **coloque de novo o seu código em CHAVE** → Salvar → **Implantar → Gerenciar implantações → ✏️ → Versão: Nova versão → Implantar**. O URL continua o mesmo.
- O código da equipe nunca fica no GitHub: só no Apps Script (privado) e em cada aparelho. Quem não tem o código não lê nem grava.

## Abrir no computador (NOVA.exe)
Dê dois cliques em **NOVA.exe** (fica nesta pasta, junto com o `index.html`). Ele abre o NOVA numa janela própria do Edge (ou Chrome), sem barra de endereço, e cria na Área de Trabalho o atalho **NOVA Local** com o ícone do NOVA.
- Funciona só neste computador (endereço interno `http://127.0.0.1:47820`); quando a janela é fechada, o NOVA.exe se encerra sozinho.
- Na primeira vez, entre com usuário/senha do Protheus e, em Pastas, digite o código da equipe (este "app" guarda os dados separado do navegador).
- Se o Windows mostrar "O Windows protegeu o computador", clique em **Mais informações → Executar assim mesmo** (o arquivo não tem assinatura digital).
- **Testar no celular**: na tela de pesquisa, clique em **📱 Usar no celular**. Com o celular no mesmo Wi-Fi, leia o código QR (ou digite o endereço `http://IP-DO-COMPUTADOR:47820`). Na primeira vez o Windows pergunta sobre o firewall: clique em **Permitir** em *Redes privadas*. Só aparelhos da rede interna conseguem abrir.
- **Ver como celular no computador**: na mesma janela, **📱 Ver como celular neste computador** abre uma janela do tamanho de um celular.
- Não precisa enviar o NOVA.exe para o GitHub.

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
