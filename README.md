# Softcom Pulse

Central de monitoramento em Next.js. O browser fala só com o BFF. O Zabbix é a telemetria, a API corporativa é o login, e o PostgreSQL do Pulse guarda só configuração de tela.

A branch de construção é a **`develop`**. Tags saem dela. Push de commit não gera imagem.

## Iniciar em local

Windows, direto no host, sem Docker. PostgreSQL na porta `5432` e Redis na porta `6379`. Copie `.env.example` para `.env` e preencha aí. Não commite `.env`.

Quando o aplicativo estiver nesta pasta:

```powershell
npm install
npx prisma migrate dev
npm run dev
```

## Versão e tag

Versão [SemVer](https://semver.org/lang/pt-BR/), sempre a partir da `develop` atualizada.

| Tag | Imagem no GHCR |
|---|---|
| `v1.2.3` | `1.2.3`, `1.2`, `1` e `latest` |
| `v1.2.3-dev` | `1.2.3-dev` e `dev` |
| `v1.2.3-beta` | `1.2.3-beta` e `dev` |
| `v1.2.3-rc.1` | `1.2.3-rc.1` e `dev` |

A action só dispara no push da tag, em `linux/amd64` e `linux/arm64`. Ela publica a imagem. Não faz deploy.

Release:

```powershell
git checkout develop
git pull
git tag v1.2.3
git push origin v1.2.3
```

Pré-release:

```powershell
git checkout develop
git pull
git tag v1.2.3-dev
git push origin v1.2.3-dev
```
