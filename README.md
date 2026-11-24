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

## Ler a etiqueta do rolo (QR code) e dar baixa
1. Toque em **📷 Ler etiqueta (QR code)** na tela de pesquisa (ou **📷 Ler QR** dentro de uma pasta) e aponte a câmera para o QR da etiqueta. Sem câmera ao vivo, use **🖼 Tirar foto da etiqueta** ou digite o RG (ex.: `FPF9164`).
2. O NOVA mostra o que está **na etiqueta** (RG, código do produto, peso líquido, OP e partida) e o que está **no Protheus** (descrição, armazém, endereço, peso atual, gramatura, CMC, datas): com o código do produto lido, consulta o estoque do produto e localiza nele o RG da etiqueta; se o RG não estiver no estoque, procura direto pelo RG, avisando se o peso da etiqueta for diferente do peso atual ou se o rolo estiver zerado.
3. Na mesma janela, digite o **peso para baixa** e o MC (ou toque em **Usar o peso da etiqueta**, que preenche o peso líquido lido) e toque em **✓ Salvar baixa**. O RG entra como pego na pasta aberta (ou na pasta ativa; sem pasta, o NOVA pede para escolher ou criar uma) e aparece na aba **Baixas**. Se a OP já estava na pasta com outros RGs, eles saem, como em "RG coletado".
- O QR traz só números: prefixo, série do RG (letras em código ASCII), número do RG, um dígito, peso líquido em centésimos, código do produto, OP e partida. O código de barras da etiqueta tem o mesmo conteúdo.
- A câmera ao vivo precisa de endereço seguro: funciona no GitHub Pages (https) e no NOVA.exe neste computador; no celular aberto pelo endereço `http://IP:47820` use a foto ou digite o RG.
- No iPhone e em navegadores sem leitor de QR próprio, o NOVA baixa o leitor **jsQR** de `cdn.jsdelivr.net` na primeira leitura (precisa de internet).

## Pastas (separação de rolos)
> **Layout das pastas (24/11):** dentro da pasta, as abas viram as 3 etapas do trabalho: **1 · Separar** (OPs a pegar), **2 · Pesar** (um RG pego por linha, com o botão **⚖ Pesar**) e **3 · Baixa** (cartões com armazém, peso, MC e os botões para copiar o RG e o código MC). Em cima há um **filtro** (RG, OP, código ou descrição) e a ordem **Produto / Endereço**. Por endereço, as OPs são agrupadas por rua (os 2 primeiros dígitos do endereço), e os endereços aparecem em destaque. **📷 Ler QR do rolo** e **＋ Código** ficam fixos no rodapé. O menu **⋯** junta Usar para salvar, Mostrar OPs já pegas em Separar (a antiga aba *Todas*), Limpar, Exportar, **Renomear** e Excluir. Para renomear com a planilha da equipe, atualize o `PLANILHA_PASTAS_Code.gs`. A lista de pastas mostra quantos faltam em cada etapa, e as pastas vazias ficam no fim.

1. Toque em **📁 Pastas**, dê um nome (ex.: `cartela`) e **Criar pasta**. A pasta fica **ativa** e o NOVA pergunta "Qual código deseja procurar?".
2. Pesquise o código, abra a OP (**Exibir mais**) e toque em **💾 Salvar em cartela** (à esquerda de Indicar defeito). Salva a OP com todos os rolos; quando a OP está em mais de um endereço, eles ficam juntos, ex.: `08196 - 01023 - 04106`. Tocar de novo numa OP já salva permite atualizar os rolos ou tirar da pasta.
3. Para buscar: **📁 Pastas → cartela**. Cada OP mostra os endereços e os rolos com uma caixinha: marque conforme for pegando (riscado em verde). **A pegar / Todos / Pegos** filtram a lista; a barra mostra o progresso.
4. **Coleta e baixa do RG**: em **A pegar**, abra a OP e toque no RG que coletou → confirme (os **outros RGs dessa OP são apagados da pasta** e fica só o coletado); o RG vai para a aba **Pegas**. Em **Pegas**, toque em qualquer parte da linha da OP → confira o produto e digite o **peso para baixa** e o **MC**, só com números, que entram como centésimos (8 = 0,08 · 80 = 0,80 · 180 = 1,80 · 1875 = 18,75; para zerar o MC, digite 0). Com o peso, a OP sai de **Pegas** e o RG aparece em **Baixas**. Na mesma tela, **↩ Não peguei** desfaz a coleta: o RG volta para *A pegar* e o NOVA busca no estoque os outros RGs da OP. Os valores ficam na planilha da equipe (colunas `peso_baixa` e `mc`).
5. **Baixas** (aba dentro da pasta): mostra só os RGs pegos que têm **Peso Total** para baixar (RG, produto/descrição, **armazém**, peso e MC), em ordem alfabética pelo RG. O armazém (01, 93 ou 98) aparece antes do peso e do MC, também na folha impressa e na lista copiada; em OPs salvas por versões antigas, sem armazém gravado, aparece —. A caixinha ☐ marca **baixa efetuada**: pede confirmação e, confirmado, o RG **sai da pasta** (para todos, com a planilha conectada); se a OP ficar sem RG, ela também sai. **🖨 Imprimir** gera a folha com a logo do Grupo Quatro K (RG em cima, descrição e código do produto embaixo, peso e MC), em **retrato ou paisagem**, com **1 ou 2 colunas** (no *Automático*, quando são muitos RGs, divide a folha em 2 colunas e diminui a letra para caber tudo numa página; a tela avisa quantas páginas vai dar); **📋 Copiar lista** copia em texto. Cada linha mostra o RG com a descrição e o código embaixo; tocar em qualquer parte da linha (menos na caixinha e no botão de copiar) abre a correção do peso, e o botão **⧉** no fim da linha copia só o RG (para colar no Protheus).
   - **Código MC do produto**: embaixo da descrição de cada RG aparece o código MC do produto (ex.: **⧉ MC00001113**); tocar nele copia o código, como o botão do RG. A regra é a mesma do app [Busca de MC](https://kuuhaku-vs.github.io/appquatrokmc/): o NCM (Pos.IPI, `B1_POSIPI`) do cadastro SB1 define o MC. O NOVA consulta todos os produtos da aba numa vez só e guarda o resultado no aparelho por 7 dias. Se o produto não tem NCM ou o NCM não tem regra, aparece **MC —** (segure/passe o mouse para ver o motivo). O código também sai no **📋 Copiar lista** (`Cód. MC`). Ao mudar a tabela NCM → MC, altere `MAPA_NCM_MC` no `protheus.js` e no `motor.js` do app de MC.
   - **Tipo e observação da baixa**: na mesma janela do peso e do MC (e na janela da etiqueta lida pelo QR) há **Pilotagem** e **Bandeira**, que podem ser marcadas **as duas juntas**, e um campo **Observação** (opcional, até 120 caracteres). Na aba Baixas o tipo aparece em etiquetas coloridas e a observação embaixo do produto; também saem na folha impressa (tipo ao lado do RG, observação na linha do código), na lista copiada, na confirmação de "baixa efetuada" e no CSV exportado (colunas `pilotagem`, `bandeira` e `obs_baixa`). Com a planilha da equipe, ficam nas colunas `pilotagem`, `bandeira` e `obs_baixa` da aba Rolos (é preciso **atualizar o `PLANILHA_PASTAS_Code.gs`**; as colunas novas são criadas sozinhas).
   - **Pilotagem + Bandeira no mesmo rolo**: ao marcar os dois tipos, abre a janela **MC de cada corte**: digite o MC da pilotagem e o da bandeira e a soma aparece na hora (`1,06 + 0,40 = 1,46`). O total vai para o **MC**, e a divisão fica visível na janela da baixa (com **Editar**), na aba Baixas (`P 1,06 + B 0,40` embaixo do MC), na folha impressa, na lista copiada e no CSV (`mc_pilotagem`, `mc_bandeira`). Os últimos MC de pilotagem viram atalhos. Desmarcar um dos tipos ou digitar outro MC desfaz a divisão.
   - **Janela da baixa enxuta**: mostra só o RG, a descrição e uma linha com código · endereço · peso em estoque (sem OP/partida). A observação é um campo de uma linha (Enter salva) e as últimas observações usadas neste aparelho aparecem como atalhos embaixo dele.
   - **Pilotagens e bandeiras que chegam do app de Pedidos**: na pasta **Pedidos** entra um item por produto (`PILOTAGEM · PV 500123, 500130` ou `BANDEIRA · PV ...` para bandeira "não alterar a cor") com os endereços que têm mais RGs. Toque no item → no endereço → escolha o RG. Tipo e observação já vêm preenchidos. Vários pedidos do mesmo artigo: um RG por pedido (a caixa mostra `1/2`).
   - **Ler o QR na pasta Pedidos**: com a pasta Pedidos aberta (ou ativa), **📷 Ler QR** na etiqueta de um RG sugerido já confirma a coleta, sem procurar na lista. Se o rolo lido é do mesmo artigo mas de outro endereço, a janela da etiqueta oferece **✓ Pegar este RG para o pedido**.
   - **✕ Não encontrei**: na confirmação do RG, se o rolo não está no endereço, toque em **Não encontrei**. O RG sai da sugestão para todos, fica anotado no item (`✕ Não encontrado: ...`), o app de Pedidos não sugere de novo e a equipe recebe aviso no celular (ntfy, mesmo canal do app de Pedidos). Se era o último RG, o NOVA procura outro endereço no estoque pela mesma regra.
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
- A consulta traz os rolos com peso nos armazéns **01, 93 e 98**; em **Mais filtros → Filtrar por → Armazém** dá para ver só um deles (ex.: `98`).
- Mesmas telas e regras do NOVA do computador: grupos por OP/Partida, prioridade (armazém 93 / AM01 / AM02, aprovado para amostra, CMC, entrada), punhos por OP, gramatura ideal da SBM (BM_GRAMTIN).
- **Defeitos e regras de gramatura ficam guardados no próprio aparelho.** Para levar os defeitos do computador para o celular: no NOVA do computador, copie o arquivo `dados/MALHAS_RUINS.csv` para o celular (e-mail, WhatsApp, OneDrive…) e, no celular, abra um grupo → **Indicar defeito → Importar planilha**. **Baixar planilha** exporta os defeitos do celular.
- "Mantenha-me conectado" guarda o acesso **neste navegador** por 30 dias. Use só no seu celular e toque em **Sair** se emprestar o aparelho.

## Atualizar
Envie de novo os arquivos alterados em **Add file → Upload files** (substituindo os antigos). O app no celular pega a versão nova ao abrir com internet. Ao alterar `styles.css` ou algum `.js`, troque também o número do `?v=` no `index.html` e o do `CACHE` no `sw.js` (o mesmo número nos dois): assim o celular nunca mistura a tela nova com o estilo antigo.

## Endereço do Protheus
Fica em `config.js`. Se não quiser o endereço da empresa visível no repositório público, troque por `apiUrl: ''`: o NOVA passa a pedir o endereço no primeiro login (`https://protheus.quatroktextil.com.br:6632/rest05`) e guarda no aparelho.

## Requisito no Protheus
O REST precisa permitir CORS (já está: `Access-Control-Allow-Origin: *`). Se um dia o TI desligar, o celular passa a mostrar "Não foi possível falar com o Protheus".
