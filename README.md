# Recuperação de senha EPAV

Cloudflare Worker para gerar links de recuperação pelo Firebase Authentication e enviar mensagens pelo Gmail `lucaslbr1a2b@gmail.com`. Projeto Firebase: `epav-game`. O HTML dos e-mails e a página de nova senha usam a identidade visual do jogo.

Repositório independente: [EPAV-GAME/epav-password-reset](https://github.com/EPAV-GAME/epav-password-reset). Apenas este repositório será publicado no Cloudflare. O formulário e a página de nova senha continuam no [epav-admin](https://github.com/EPAV-GAME/epav-admin), publicado no GitHub Pages. A integração entre eles é feita por HTTP; este serviço não depende dos arquivos do painel para executar, testar ou publicar.

## Estado atual

Publicado em [epav-password-reset.kevinernandes2012.workers.dev](https://epav-password-reset.kevinernandes2012.workers.dev/health), na conta Cloudflare de Kevin. Os segredos do Firebase, dos limites e do Gmail foram configurados; `/health` retornou HTTP 200. A validação pública ainda depende de `TURNSTILE_SECRET_KEY`. Nenhum envio real foi feito. Os testes de SMTP usam um servidor simulado; o endpoint de saúde não confirma autenticação SMTP ou entrega de e-mail.

O painel no GitHub Pages já recebeu a URL do serviço e a chave pública do widget Turnstile. A publicação automática do Worker continua pendente do token de API para o GitHub Actions; a primeira publicação foi feita com o perfil OAuth local `epav`.

## Fluxo

1. Um administrador solicita a recuperação no painel; a API verifica o token Firebase e a permissão administrativa atual no servidor. Pessoas sem sessão podem usar o formulário público com Turnstile.
2. A API aplica limites de solicitações e responde de forma igual para e-mails cadastrados e não cadastrados.
3. Em segundo plano, o Firebase gera um link sem enviar seu próprio e-mail; o Worker envia a mensagem por SMTP com TLS na porta 465.
4. O destinatário abre `resetar-senha.html`; o SDK Firebase verifica o código e confirma a nova senha diretamente no Firebase. A API de e-mail nunca recebe a nova senha.

O status HTTP 202 confirma o recebimento da solicitação, não a entrega do e-mail. As falhas são registradas por identificador, sem endereço do destinatário, credenciais ou link. Não há fila persistente nem repetição automática de falhas. Gmail pode recusar envios ou aplicar limites próprios; confira os logs ao ativar o serviço.

## Rotas

| Método e rota | Acesso | Corpo |
| --- | --- | --- |
| `GET /health` | Público | Sem corpo; 503 enquanto faltarem segredos básicos |
| `POST /admin/password-reset` | `Authorization: Bearer <Firebase ID token>` de administrador | `{ "email": "pessoa@example.com" }` |
| `POST /auth/forgot-password` | Turnstile válido, hostname autorizado, ação `password-reset` | `{ "email": "pessoa@example.com", "turnstileToken": "..." }` |

Resposta aceita: `{ "sucesso": true, "mensagem": "Se este e-mail estiver cadastrado, você receberá as instruções de recuperação." }`.

Origens web permitidas: `https://epav-game.github.io`. Os limites nativos configurados são 5 solicitações por IP/minuto, 1 por destinatário/minuto e 30 por minuto para o serviço. Os limites são aproximados por localização Cloudflare, não um contador global rigoroso. As chaves de IP/e-mail são derivadas com HMAC. O endpoint de saúde verifica a presença das configurações; não testa Gmail ou Firebase nem indica prontidão do Turnstile.

## Verificar localmente

Requer Node.js 24. Na raiz deste repositório:

```powershell
npm ci
npm test
npm run build
```

`build` gera o pacote com `wrangler deploy --dry-run`, sem publicar. Para desenvolvimento, copie `.dev.vars.example` para `.dev.vars`, preencha os segredos localmente e execute `npm run dev`. Esse arquivo é ignorado pelo Git. Alterações em origem/hostname/URL local devem ser feitas apenas para o ambiente de desenvolvimento.

## Publicação pendente

1. Entrar no Cloudflare da conta escolhida e confirmar o account ID. Não usar automaticamente outra conta que já esteja autenticada no computador. Definir `CLOUDFLARE_ACCOUNT_ID` no ambiente dos comandos Wrangler para fixar a conta.
2. Autenticar o Wrangler, conferir a conta com `wrangler whoami` e publicar com `npm run deploy`.
3. Configurar os segredos abaixo no Worker. O JSON de conta de serviço fica fora do repositório.
4. Criar um widget Turnstile para `epav-game.github.io` e inserir a chave secreta no Worker.
5. No repositório **epav-admin**, configurar as variáveis públicas `PASSWORD_RESET_SERVICE_URL` com a URL HTTPS do Worker (sem rota) e `TURNSTILE_SITE_KEY` com a chave pública do widget. A publicação do Pages inclui a configuração pública e a página de nova senha.
6. No repositório **epav-password-reset**, guardar um token Cloudflare limitado à conta/projeto como GitHub secret `CLOUDFLARE_API_TOKEN` e definir as repository variables `CLOUDFLARE_ACCOUNT_ID` e `PASSWORD_RESET_SERVICE_URL`. O workflow `.github/workflows/deploy.yml` verifica o código e só tenta publicar quando o account ID estiver definido. Não substituir o token de API por um token OAuth local.
7. Conferir `/health` e testar o envio para um endereço autorizado com conta no Firebase. Validar o e-mail recebido e a recuperação. Essa validação real ainda está pendente.

### Segredos do Worker

| Nome | Origem |
| --- | --- |
| `FIREBASE_API_KEY` | Configuração do app Web Firebase |
| `FIREBASE_CLIENT_EMAIL` | Campo `client_email` da conta de serviço |
| `FIREBASE_PRIVATE_KEY` | Campo `private_key` da conta de serviço |
| `GMAIL_APP_PASSWORD` | Senha de app de 16 caracteres da conta remetente |
| `RATE_LIMIT_SALT` | Valor aleatório estável, recomendado 32 bytes |
| `TURNSTILE_SECRET_KEY` | Chave secreta do widget Cloudflare |

O Gmail requer verificação em duas etapas para criar uma senha de app: [orientações oficiais do Google](https://support.google.com/accounts/answer/185833?hl=pt-BR). Inserir `GMAIL_APP_PASSWORD` diretamente nos segredos do Worker, sem compartilhar no chat ou escrever no código.

O comando `npm run configure:secrets` lê o arquivo indicado por `FIREBASE_SERVICE_ACCOUNT_PATH` e a API key indicada por `FIREBASE_API_KEY` no ambiente. Exige também `CLOUDFLARE_ACCOUNT_ID` para fixar o destino. Envia as credenciais ao Wrangler por stdin, sem imprimi-las. Também envia os segredos opcionais presentes no ambiente. Defina `RATE_LIMIT_SALT` na primeira configuração; não troque esse valor em cada publicação. Nunca execute esse comando sem confirmar a conta Cloudflare de destino.

## Referência

Inspirado no fluxo do [ludos-password-reset](https://github.com/Ludos-Souk/ludos-password-reset): gerar o link no Firebase, adaptar para a página de nova senha e enviar uma mensagem própria. Aqui o envio usa Gmail e o backend roda como Worker no Cloudflare.
