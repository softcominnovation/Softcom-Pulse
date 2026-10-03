# Autenticação

O Pulse autentica colaboradores com e-mail e senha na API corporativa. O navegador usa exclusivamente as rotas do BFF da mesma origem. Não há cadastro ou tabela local de usuários, login de parceiro, gate por administrador ou mapeamento de permissões.

## Configuração

- `API_BASE_URL=https://api.softcom.cloud`, somente no servidor. Sem barra final; o BFF normaliza essa barra.
- `CORPORATE_API_URL` é fallback legado se `API_BASE_URL` estiver ausente/vazia. Se nenhuma estiver definida, a base é `https://api.softcom.cloud`. Novas instalações e composes usam `API_BASE_URL`.
- `TOKEN_ENCRYPTION_KEY` é obrigatória: exatamente 32 bytes aleatórios em base64 padrão, sem espaços. Não é uma senha ou uma chave interna da API. Usar segredo independente por ambiente e a mesma chave em todas as réplicas daquele ambiente.
- Gerar a chave em ambiente privado, guardar no `.env` ignorado ou no ambiente da stack. Trocar a chave invalida os envelopes existentes e exige novo login. Não colocar essas variáveis em `NEXT_PUBLIC_`, argumentos de build ou logs.
- Nome e URL institucional vêm do provider público em runtime. O diretório `public` contém as marcas e a ilustração; as pastas locais de referência não são necessárias em execução.

O upstream exige HTTPS; HTTP fica restrito a loopback para testes. Redirecionamentos não são seguidos. A chamada corporativa tem limite de dez segundos.

## Contrato corporativo confirmado

Documentação consultada em 02/10/2026: [Swagger de autenticação](https://api.softcom.cloud/api/docs?urls.primaryName=Autentica%C3%A7%C3%A3o#/) e [OpenAPI](https://api.softcom.cloud/api/docs/admin-json).

| Operação | Endpoint | Corpo |
|---|---|---|
| Login | `POST /v1/auth/login` | `{email, senha}` |
| Renovação | `POST /v1/auth/refresh` | `{refreshToken}` |
| Logout | `POST /v1/auth/logout` | `{refreshToken}` |

Essas três operações enviam somente `Content-Type: application/json` como header de aplicação. Não enviam Bearer, `x-api-key`, `SOFTCOM_API_KEY` ou outro segredo de serviço. Login aceita e-mail de até 150 caracteres e senha de 1 a 50. O BFF remove espaços externos do e-mail; preserva a senha. A API documenta 401 e 429 no login, refresh rotativo e logout idempotente com sucesso 204.

O usuário é recebido no login/refresh. Não há consulta a `/me`, JWKS ou introspecção. `id`, `nome`, `nomeCompleto`, `email`, `setor`, `empresa`, `administrador`, `acessos`, `permissoes` e `solicitante` são preservados quando fornecidos. Campos ausentes numa renovação mantêm o contexto anterior autenticado; valores explícitos como `null`, `false` e `[]` substituem o anterior. Refresh não pode trocar o ID da identidade.

## Contrato do BFF

| Rota | Entrada | Sucesso |
|---|---|---|
| `POST /api/auth/login` | JSON `{email, senha}` | `{accessToken, refreshToken, tokenType: "Bearer", expiresIn, expiresAt, user}` |
| `POST /api/auth/refresh` | JSON `{refreshToken}`, cifrado | Mesmo contrato de sessão, com novo par |
| `POST /api/auth/logout` | JSON `{refreshToken}`, cifrado | `{revoked: true}` quando o upstream confirma |
| `GET /api/auth/session` | `Authorization: Bearer <access cifrado>` | `{user, expiresAt}` |

Todos os tokens expostos pelo Pulse são envelopes; nenhum JWT ou refresh corporativo original é devolvido ao browser. `expiresAt` é epoch em milissegundos calculado no BFF; `expiresIn` usa segundos. Todas as respostas de autenticação, inclusive erros, usam `Cache-Control: no-store`.

Erros públicos têm formato `{error: {code}}`:

| Status | Código | Significado |
|---|---|---|
| 400 | `invalid_request` | JSON ou credenciais fora do contrato |
| 401 | `credentials_invalid` | Login rejeitado |
| 401 | `session_invalid` | Envelope ausente, adulterado, vencido, finalidade errada ou refresh rejeitado |
| 429 | `rate_limited` | Muitas tentativas no upstream |
| 502/503 | `auth_unavailable` | Upstream indisponível, timeout, contrato inválido ou configuração inválida |
| 500 | `auth_unavailable` | Falha interna não prevista |

Não há repasse do corpo bruto de erro, senha, token ou detalhes de conexão. Erro de rede é apresentado como indisponibilidade, distinto de credencial rejeitada.

## Cifra e validação

Formato: `v1.<nonce base64url>.<ciphertext base64url>.<tag base64url>`. AES-256-GCM usa nonce aleatório de 12 bytes, tag de 16 bytes e dados autenticados adicionais `pulse.auth.v1`. O payload autenticado contém tipo `access` ou `refresh`, token corporativo, ID da sessão e usuário; access também contém a expiração.

A validade usa `expiresIn` positivo e finito; fallback 7200 segundos. Quando o access recebido diretamente da API contém `exp`, ele limita a validade do envelope. Decodificar esse JWT não substitui verificação de assinatura: a fonte confiável aqui é a resposta corporativa obtida pelo servidor, e a autenticidade dos pedidos posteriores é verificada pelo GCM.

`requireSession(request)`, em `lib/server/auth/index.ts`, é o ponto obrigatório para futuras APIs protegidas. Verifica header, integridade, finalidade e expiração antes de liberar o contexto confiável. O bloqueio visual em React não protege API e não deve ser usado para autorizar consultas no servidor. Não confiar no usuário ou no horário enviados pelo storage.

A sessão é stateless no BFF. Sem introspecção corporativa, não há garantia de revogação imediata de access: um envelope copiado continua utilizável até expirar. Logout revoga o refresh na API e limpa a sessão local. A cifra oculta os tokens originais, mas o envelope continua sendo uma credencial; HTTPS e prevenção de XSS continuam necessários.

## Estado, renovação e abas

A store Zustand usa `lib/client/auth-session.ts`. Persistência manual em `localStorage["pulse.auth.v1"]`, com registro `{version: 1, epoch, session}`. `session` contém par cifrado, usuário, tipo e validade. Logout persiste `session: null`: a geração vazia permite identificar respostas de uma sessão encerrada.

- Reidratar e validar no BFF antes de exibir conteúdo protegido; não confiar no usuário recuperado do storage.
- Renovar trinta segundos antes de vencer, com uma promessa compartilhada na aba.
- Web Lock `pulse.auth.refresh.v1` coordena a rotação entre abas. Reler o registro dentro da trava; quem encontra um par já atualizado o reutiliza.
- Web Lock `pulse.auth.storage.v1` serializa gravações breves de login, renovação, validação e logout. A validação não sobrescreve um par atualizado enquanto sua resposta estava em trânsito.
- Eventos `storage` propagam alterações; não substituem a trava. Retorno à aba ou reconexão revalida a sessão.
- 401 de API protegida provoca refresh e apenas uma repetição; auth e health não entram nesse interceptor. 403 de negócio e falha de rede/5xx não provocam logout.
- 401/403 do refresh encerra a sessão. Falha transitória mantém o registro cifrado e apresenta estado de indisponibilidade com nova tentativa; não libera conteúdo sem validação.
- Logout/novo login muda a geração, aborta requests e limpa estado de apresentação. Resposta antiga não restaura nem apaga uma sessão posterior.
- Sem Web Locks, o login continua possível, mas a renovação é recusada e a interface solicita novo login. Em storage bloqueado ou inválido, há mensagem explícita; não há rotação insegura baseada apenas em evento ou temporizador.

Logout limpa a interface imediatamente e tenta a revogação remota. Se a API falhar, a interface informa que a saída local ocorreu, mas não foi possível confirmar o encerramento remoto. Uma rotação que já tenha sido processada pela API durante cancelamento pode não ter sua resposta recebida; não se promete revogação de um novo token desconhecido.

## Interface e validação

`/login` apresenta a composição de duas metades a partir de 1024px e coluna única abaixo disso. Ilustração padrão PNG, proporção 4:3, limite 320×240; assinatura institucional preserva suas cores. A arte decorativa não é baixada no mobile. Fonte de sistema, fundo `#0c1116`, superfície `#121a21`, inputs `#18232c`, botão `#64d6b0`, raio 7px e controles com pelo menos 44px.

`/` usa shell protegido com marca, relógio de Fortaleza e saída, seguido de título/texto. Não há métricas, sidebar, TV, fullscreen ou rotas administrativas nesta etapa.

Testes de contrato usam respostas corporativas simuladas e exercitam os handlers reais. Testes de navegador e standalone iniciam um upstream HTTP exclusivo em loopback, nunca uma conta real. Incluem duas abas reais, refresh rotativo, ausência de tokens originais no storage, erros, logout, assets e responsividade. O teste com credenciais reais deve ser feito separadamente pelo responsável; a suíte local não o comprova.
