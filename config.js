// Configuração do NOVA (versão GitHub/celular).
// apiUrl: endereço do REST do Protheus (sem o /api/... no final).
//   Deixe vazio ('') para NÃO publicar o endereço da empresa no código:
//   nesse caso o NOVA pede o endereço na primeira vez que alguém entrar.
// tenantId: empresa,filial usadas nas consultas.
window.NOVA_CONFIG = {
  apiUrl: 'https://protheus.quatroktextil.com.br:6632/rest05',
  tenantId: '01,14',
  // armazens: todos os armazéns que aparecem para escolher na tela (dá para incluir outros pela tela, no botão ＋).
  // armazensPadrao: os que já vêm marcados na consulta.
  armazens: ['01', '89', '93', '97', '98'],
  armazensPadrao: ['01', '93', '98'],
  // pastasUrl: "URL do app da Web" da Planilha Google das pastas compartilhadas (Apps Script).
  //   O código da equipe NÃO fica aqui: cada aparelho digita uma vez em Pastas.
  pastasUrl: 'https://script.google.com/macros/s/AKfycbyHBouPxpAfFQeOYGLMdvaqpvRF7XhZSJxCqeY13T_zXFauD8SS_DCGdPQt0hQpfw/exec'
};
