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

Abra http://127.0.0.1:3000/login e entre com o e-mail e a senha de colaborador. O login abre `/`, com o dashboard protegido: indicadores, recursos destacados, problemas e resumo Asgard/VMs. Os destaques ocupam uma faixa acima dos painéis compactos de ASGARD e problemas. “Ver ASGARD” abre `/asgard` com métricas e tabela detalhadas. A apresentação salva define os blocos e até três telas; modos overview/wall, TV, fullscreen e alternância funcionam também no celular. Controles, qualidade dos dados e padrões de interface: [docs/ui.md](docs/ui.md). `GET /api/health` verifica banco e cache. Fluxo, sessão e requisitos de navegador: [docs/authentication.md](docs/authentication.md). O schema contém três tabelas de configuração humana. `migrate dev` aplica as migrations; os scripts de dev/build geram o cliente Prisma automaticamente. Apresentação compartilhada, CRUD, snapshots e leituras autenticadas: [docs/bff.md](docs/bff.md).

Templates `tpl*` têm consultas próprias e metadados persistidos para labels e classificação Worker/Manager. Não entram na contagem operacional de VMs, preservando os recursos gerais do ASGARD. Contratos, capacidades disponíveis e limites: [docs/templates.md](docs/templates.md). O editor visual de templates está previsto para as configurações administrativas.

As abas Infraestrutura e Asgard & VMs abrem o inventário e os detalhes com históricos reais. Clique no nome de uma VM para selecionar seu gráfico, com períodos de 1 hora, 24 horas e 7 dias preservados na URL. VMs sem Agent continuam acessíveis pela perspectiva do hipervisor; vínculos confirmados oferecem também os detalhes internos do Linux. Unidades, lacunas, navegação e limites: [docs/infrastructure.md](docs/infrastructure.md).

Para alimentar o monitoramento, preencha `ZABBIX_API_URL` e `ZABBIX_API_TOKEN`, confirme o escopo e execute `npm run collector` em outro terminal. `npm run collector:once` coleta uma única vez. O processo não abre porta HTTP. Configuração de escopo, mapeamento, históricos e limites: [docs/zabbix.md](docs/zabbix.md). Sem coleta válida, o BFF informa ausência ou desatualização dos dados.

`npm run check` valida lint, tipos, testes e build. Variáveis, versões, stacks, migrations e testes adicionais: [docs/environment.md](docs/environment.md).

## Versão e tag

Versão [SemVer](https://semver.org/lang/pt-BR/). A tag sem sufixo é produção. A tag com `-dev` é desenvolvimento.

| Tag | Branch | Imagem | Ambiente |
|---|---|---|---|
| `v1.2.3` | `main` | `1.2.3`, `1.2`, `1` e `latest` | https://pulse.softcomtecnologia.com |
| `v1.2.3-dev` | `develop` | `1.2.3-dev` e `dev` | https://dev-pulse.softcomtecnologia.com |

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
