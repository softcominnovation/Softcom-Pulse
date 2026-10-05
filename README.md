# Softcom Pulse

Central de monitoramento em Next.js. O browser fala só com o BFF. O Zabbix é a telemetria, a API corporativa é o login, e o PostgreSQL do Pulse guarda só configuração de tela.

A branch de desenvolvimento é a **`develop`**. A de produção é a **`main`**. Push de commit não gera imagem. A tag é que gera.

## Iniciar em local

Windows com Node 24 LTS, direto no host, sem Docker. PostgreSQL na porta `5432` e Redis na porta `6379`. Copie `.env.example` para `.env` se ainda não existir e preencha `DATABASE_URL`, `REDIS_URL`, `API_BASE_URL` e `TOKEN_ENCRYPTION_KEY` (32 bytes aleatórios em base64, somente no servidor). Não commite `.env`.

Na pasta do aplicativo:

```powershell
npm install
npm run db:prepare
npx prisma migrate dev
npm run dev
```

Abra http://127.0.0.1:3000/login e entre com o e-mail e a senha de colaborador. O login abre `/`, já protegida; o dashboard visual será incorporado nessa página. `GET /api/health` verifica banco e cache. Fluxo, sessão e requisitos de navegador: [docs/authentication.md](docs/authentication.md). O schema já contém as duas tabelas de configuração humana. `migrate dev` aplica a migration; os scripts de dev/build geram o cliente Prisma automaticamente. Apresentação compartilhada, CRUD, snapshots e leituras autenticadas: [docs/bff.md](docs/bff.md).

Para alimentar o monitoramento, preencha `ZABBIX_API_URL` e `ZABBIX_API_TOKEN`, confirme o escopo e execute `npm run collector` em outro terminal. `npm run collector:once` coleta uma única vez. O processo não abre porta HTTP. Configuração de escopo, mapeamento, históricos e limites: [docs/zabbix.md](docs/zabbix.md). Sem coleta válida, o BFF informa ausência ou desatualização dos dados.

`npm run check` valida lint, tipos, testes e build. Variáveis, versões, stacks, migrations e testes adicionais: [docs/environment.md](docs/environment.md).

## Versão e tag

Versão [SemVer](https://semver.org/lang/pt-BR/). A tag sem sufixo é produção. A tag com `-dev` é desenvolvimento.

| Tag | Branch | Imagem | Ambiente |
|---|---|---|---|
| `v1.2.3` | `main` | `1.2.3`, `1.2`, `1` e `latest` | https://pulse.hostsoftcom.cloud |
| `v1.2.3-dev` | `develop` | `1.2.3-dev` e `dev` | https://dev-pulse.hostsoftcom.cloud |

A action só dispara no push da tag, em `linux/amd64` e `linux/arm64`. Ela publica a imagem. Não faz deploy.

Produção, a partir da `main`:

```powershell
git checkout main
git pull
git tag v1.2.3
git push origin v1.2.3
```

Desenvolvimento, a partir da `develop`:

```powershell
git checkout develop
git pull
git tag v1.2.3-dev
git push origin v1.2.3-dev
```
