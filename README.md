# Softcom Pulse

Central de monitoramento em Next.js. O browser fala só com o BFF. O Zabbix é a telemetria, a API corporativa é o login, e o PostgreSQL do Pulse guarda só configuração de tela.

A branch de desenvolvimento é a **`develop`**. A de produção é a **`main`**. Push de commit não gera imagem. A tag é que gera.

## Iniciar em local

Windows com Node 24 LTS, direto no host, sem Docker. PostgreSQL na porta `5432` e Redis na porta `6379`. Copie `.env.example` para `.env` se ainda não existir e preencha `DATABASE_URL` e `REDIS_URL`. Não commite `.env`.

Na pasta do aplicativo:

```powershell
npm install
npm run db:prepare
npx prisma migrate dev
npm run dev
```

Abra http://127.0.0.1:3000. A base inicial tem a página de presença e `GET /api/health`; autenticação e monitoramento entram nas próximas etapas. O schema inicial não tem tabela de negócio: `migrate dev` apenas confirma o baseline, sem migration fictícia.

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
