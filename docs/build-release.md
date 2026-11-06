# Build, imagem e publicação

Revisão de 05/11/2026, após `a5dfe82` (`feat: improve monitor readability and responsive dashboard typography`), versão informada `0.6.8-dev`. A otimização preserva layouts, configurações de negócio e workers. A correção complementar da rolagem encontrada no CI está descrita ao final.

## Pacote de execução

`npm run build` continua gerando Prisma, compilando Next e executando `scripts/package-collector.mjs`. O script agora monta um standalone completo: servidor Next e arquivos estáticos, public, quatro workers, módulos compartilhados, cliente gerado, schema/migrations e inicializador com advisory lock. Acrescenta apenas as árvores de dependências necessárias aos workers, CLI Prisma, dotenv e Sharp, incluindo dependências opcionais disponíveis para a plataforma. Pacotes que exportam somente subpaths são localizados pelo manifesto instalado, sem depender de um entrypoint raiz.

O Docker copia esse diretório uma vez. Foi removida a segunda instalação `npm ci --omit=dev` e a sobreposição de todo o `node_modules` de produção. CLI/engines Prisma continuam presentes porque cada processo executa migrations serializadas antes de iniciar. As dependências declaradas pela CLI são preservadas; não há remoção manual de arquivos internos do Prisma. Sharp inclui seus binários e bibliotecas nativas, que são exercitados na verificação.

`scripts/runtime-links.mjs` torna internos e relativos os aliases de dependências emitidos pelo Turbopack. Links para arquivos externos ao checkout são rejeitados. No Windows sem permissão para links simbólicos, o alias é materializado; não se usa junction absoluta que dependa da máquina de build. Na cópia isolada dos testes, a verificação nativa roda em subprocesso, para liberar as DLLs antes da limpeza da pasta temporária.

Arquivos `.env*` na raiz do standalone são removidos do artefato gerado, nunca dos arquivos de configuração do desenvolvedor. A imagem mantém Node 24 Bookworm slim, OpenSSL, certificados e usuário `node`. O entrypoint permanece `docker/entrypoint.sh`; sem novos processos de produto ou alterações nas stacks.

## Fluxo de CI

Os dois workflows de tag delegam a `release.yml`, reutilizável e sem gatilho independente de publicação. Formatos de tag, ancestralidade develop/main, aliases GHCR e ausência de deploy permanecem iguais.

1. `release`: valida tag e ancestralidade antes de iniciar trabalhos de compilação/publicação.
2. `runtime`: matriz nativa AMD64 (`ubuntu-24.04`) e ARM64 (`ubuntu-24.04-arm`), com uma compilação por arquitetura. AMD64 executa check, integração e runtime completos. ARM64 compila e valida o pacote isolado, servidor, dependências nativas e migrations reais. Os artefatos são arquivados em tar.gz para preservar permissões, com retenção de dois dias.
3. `interface`: em paralelo, componentes e dois shards completos de E2E. Cada job tem seu próprio PostgreSQL, Redis e checkout; preservados os dois workers Playwright por shard. O cliente Prisma é gerado antes das suítes. Nenhum teste é retirado. Traces de falha ficam disponíveis por cinco dias.
4. `images`: só após runtime e interface aprovados, cada arquitetura recebe seu artefato correspondente e monta a imagem sem recompilar (`RUNTIME_SOURCE=prebuilt`). Executa o entrypoint real, migrations num PostgreSQL descartável, quatro workers com `--check`, CLI, Sharp e UID sem root. Somente depois envia a imagem por digest, sem mover aliases de versão.
5. `publish`: aguarda as duas imagens, valida previamente o índice combinado e publica os aliases existentes. Confere novamente os digests AMD64/ARM64. Uma falha em qualquer suíte/arquitetura impede a atualização das tags de versão. Imagens já enviadas por digest podem permanecer sem alias se o outro job falhar; não são uma release parcial.

Os limites são por job: 10 minutos para tag, 60 por runtime, 45 por suíte de interface, 30 por imagem e 15 para manifesto. A paralelização reduz o tempo de espera, mas pode consumir mais minutos de CI. Exige que a organização permita runners ARM64 hospedados e os actions oficiais usados. Não há fallback silencioso para QEMU.

## Cache

- Downloads npm continuam pelo cache do setup-node.
- `.next/cache` é persistido por sistema, arquitetura, lockfile/Node e commit, com restauração de prefixo compatível. Não se compartilham artefatos nativos entre AMD64 e ARM64, nem caches `.next/dev`/validadores.
- O cache Actions respeita o escopo de refs do GitHub: uma nova tag não consegue recuperar automaticamente caches exclusivos de outra tag. Reexecuções da mesma ref e caches acessíveis da branch padrão podem aquecer o build. Não presumir cache quente em toda release. Não foi adicionado gatilho em branches só para aquecê-lo.
- Builds Docker locais convencionais mantêm cache mounts para npm e `.next/cache`; o de compilação é separado por arquitetura e tem escrita serializada. Na CI, o Docker apenas empacota o resultado validado e usa cache de camadas por ambiente/arquitetura. Exportação de cache é auxiliar (`ignore-error=true`); falhas de testes/build/push não são ignoradas. Cache mounts locais não são exportados pelo cache de camadas; a compilação da CI usa o cache Actions descrito acima.

## Validação e medição

`scripts/verify-runtime.mjs` verifica arquivos, dependências resolvidas dentro do pacote, ausência de env local, quatro workers, Prisma validate e processamento nativo Sharp. Informa MiB do diretório. A CI registra também bytes da imagem sem compressão no resumo do job. Compare a mesma arquitetura e a mesma medida (imagem descompactada, download comprimido ou soma do índice multiarch).

`tests/runtime/package.test.mjs` copia o artefato para fora do repositório, impedindo que dependências da instalação de desenvolvimento ocultem omissões. Executa migrations concorrentes num banco temporário, inicia o servidor standalone e verifica login/health. As outras suítes de runtime continuam cobrindo monitor, iframe, notificações, persistência e coleta.

Comandos de verificação local:

```text
npm run check
npm run test:integration
npm run test:runtime
npm run test:components
node scripts/verify-runtime.mjs .next/standalone
.cache/tools/actionlint.exe -shellcheck= -pyflakes= .github/workflows/deploy-dev.yml .github/workflows/deploy-prod.yml .github/workflows/release.yml
```

`docker build .` continua suportado e compila dentro do container. `RUNTIME_SOURCE=prebuilt` é reservado ao artefato validado da mesma plataforma: nunca fornecer um pacote Windows para uma imagem Linux. O pacote temporário `.runtime/` é ignorado pelo Git. No fluxo remoto, o smoke na imagem Debian verifica a compatibilidade dos binários produzidos no runner Linux antes do push.

Resultados locais desta revisão:

- Lint, tipos, 299 testes unitários e build aprovados novamente após a correção final da rolagem. Standalone reempacotado com as correções.
- 77 testes de integração e 32 de componentes aprovados.
- 25 testes runtime aprovados na rodada completa final, sem falhas ou skips, incluindo as duas regressões novas de rolagem. O pacote isolado executou os quatro workers, Prisma/Sharp, migrations concorrentes reais e servidor fora do checkout.
- Os dois casos de atualização/posição passaram também em cinco rodadas consecutivas após a correção do controlador. Os cinco E2E de rolagem do `/monitor` moderno passaram, cobrindo ida/volta, pausa, troca de telas, atualização e início ligado/desligado.
- A primeira rodada encontrou uma oscilação no teste existente de posição de scroll, que passou em repetição. Após a reincidência no CI da `0.6.8-dev`, o diagnóstico revelou perda real de posição na reativação de regiões após zoom, além da espera incompleta do teste. Correções descritas abaixo; nenhum retry foi adicionado para ocultar falhas.
- Actionlint dos três workflows e contratos de publicação aprovados. Após as regressões de navegação lenta, a suíte tem 370 E2E, divididos em dois shards de 185. A execução completa e a revalidação dos arquivos corrigidos estão detalhadas ao final; a suíte integral permanece obrigatória nos jobs de CI.
- Pacote Windows final: **355,6 MiB**, sem contar novamente os destinos de links simbólicos. É a medição do diretório de execução, não do tamanho da imagem Docker Linux.

A execução real dos runners ARM64, Docker e publicação no GHCR depende do próximo pipeline autorizado; não é substituída pelos testes Windows. Docker não está instalado neste ambiente. Não há promessa de tamanho final ou redução de minutos sem essa medição. Nenhum commit, push ou deploy foi realizado.

## Correção do teste de scroll da 0.6.8-dev

O erro em `tests/runtime/monitor-compat.test.mjs` apareceu na comparação de posição após refresh. Além de sincronizar a captura com o término nativo de `End`, foi necessário corrigir o controlador compartilhado de rolagem. O teste voltou a falhar nas repetições, expondo o Signal sendo zerado por um scan antes de atualizar: uma região que deixou de ter overflow durante o zoom era reativada com sua posição antiga em cache, sobrescrevendo o movimento manual mais recente.

`public/monitor-auto-scroll.js` passa a reconhecer a reativação do mesmo nó e preservar sua posição atual. A restauração do cache continua quando o HTML é substituído. Não altera dimensões, fórmulas de zoom, velocidade ou pausas. Um teste determinístico reproduziu o defeito antes da correção (17px recebidos em vez dos 63px esperados) e cobre rolagem ligada/pausada. Outro mantém a resposta pendente e confirma a preservação de movimentos durante a espera. O caso original mantém a tolerância de 1px, compara painéis por UUID, espera o DOM novo e informa os valores divergentes.

`.env not found. Continuing without it.` é esperado no runner: as conexões de teste são fornecidas por variáveis do job. As saídas 1 de workers nos cenários deliberados de falha também não eram a causa desse resultado; o caso do collector terminou aprovado. O erro que interrompeu a suíte foi a asserção de scroll.

Por orientação do responsável, a versão pretendida continua `v0.6.8-dev`. O fluxo lê a tag do GitHub; exemplos de versões nos testes de publicação não definem a versão publicada. Nenhuma tag local/remota foi excluída, criada ou enviada pelo agente.

Referências: [standalone do Next](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), [cache de compilação](https://nextjs.org/docs/app/guides/ci-build-caching), [cache mounts Docker](https://docs.docker.com/reference/dockerfile/#run---mounttypecache), [builds distribuídos Docker](https://docs.docker.com/build/ci/github-actions/multi-platform/), [runners nativos](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

## Revisão dos dois shards de interface — 05/11/2026

O caso de escala a 1366px foi reproduzido em três execuções consecutivas. A comparação usava a caixa inteira do último painel, incluindo a parte recortada pela rolagem da composição, contra a posição da legenda. O contrato existente permite essa rolagem quando os mínimos não cabem. A asserção passou a verificar a caixa visível da composição, a legenda desobstruída e o acesso ao final do painel após rolar. Não houve alteração de CSS, dimensões, zoom ou tolerância de 1px.

A falha de navegação para Serviços foi reproduzida nas duas rotas com uma resposta RSC atrasada em seis segundos: o teste fazia o clique e usava a asserção de URL, limitada a cinco segundos, como espera de navegação. Agora aguarda a chegada à rota pelo próprio mecanismo de navegação, dentro do prazo original do teste, e só depois verifica o resultado. Dois cenários permanentes cobrem essa demora em `/` e `/monitor`, preservando a verificação de favicons, ausência de erros React e opções da segunda tela. O teste de produção também aguarda cada destino antes do próximo clique; antes podia cancelar uma navegação com a seguinte.

Não foram adicionados retries, exclusões de casos ou aumentos globais de timeout. O aviso de Reduced Motion continua informativo.

A execução completa de 370 E2E encontrou mais uma corrida em `storage.spec.ts`: ao alternar modos no formato wall a 3440px, o atributo da escala já estava atualizado, mas a leitura síncrona do corpo encontrou 0px antes do ajuste pelo `ResizeObserver`. O caso agora aguarda conjuntamente a geometria resultante: corpo maior que 30px, rodapé dentro do viewport, ausência de sobreposição e ausência de overflow horizontal. Os limites e o prazo padrão permanecem iguais. A mudança é no teste; não altera o dimensionamento dos painéis.

Na validação local, não executar a suíte de produção junto dos dois workers E2E na mesma máquina: a tentativa concorrente excedeu o prazo total dos casos de escala a 1920/3440px durante recargas e cancelou o teste de áudio/toasts em 120s. O caso de áudio passou isoladamente em 33,7s, sem alteração de código ou prazo. A rodada de interface concorrente foi interrompida e seu ambiente temporário foi limpo antes da repetição completa isolada. Isso não exige serializar os jobs da CI, que já usam runners distintos.

Validação final desta revisão:

- `npm run check` aprovado: lint (somente o aviso preexistente de `IconBrandWhatsapp`), tipos, 299 testes unitários e build. Lint dos quatro arquivos de testes alterados e tipos repetidos após o ajuste final do Storage, ambos aprovados.
- 32 testes de componentes e 77 de integração aprovados.
- 370 E2E executados integralmente: 369 aprovados e a corrida adicional de Storage identificada. Após corrigi-la, os três arquivos completos afetados passaram juntos: **47/47**. Incluem os dois casos originais, suas variantes de navegação lenta, todas as escalas e as nove composições de Storage. O caso wall/3440px passou ainda em **cinco repetições consecutivas**. Os 323 casos fora desses arquivos passaram na rodada completa; não foi feita outra execução integral após essa última mudança restrita ao teste.
- Rodada final isolada de runtime: **25/25**, sem falhas, cancelamentos ou skips (272s). Inclui áudio/toasts, scroll, iframe, navegação, pacote fora do checkout, quatro workers e migrations. O cancelamento por sobrecarga da tentativa paralela não foi contado como aprovação.
- Listagem de CI atualizada: **185 + 185 = 370** casos. Nenhum retry automático ou caso ignorado foi acrescentado.

Essa evidência é local em Windows. O próximo CI continua responsável pela execução Linux, runners AMD64/ARM64 e montagem das imagens; nenhum commit, tag, push ou deploy foi realizado.

## Correção dos shards de fontes e edição — 06/11/2026

Os três casos compactos de `monitor-fonts.spec.ts` falhavam por overflow horizontal do rodapé de minicards de uptime, não pela altura das fileiras. A coluna implícita `auto` de `.probe-card-uptime` podia crescer com o texto sem quebra, sobretudo com fontes mais largas. A correção em `public-monitor.css` restringe essa coluna a `minmax(0, 1fr)`, exclusivamente no `/monitor`. Permanecem os tamanhos dos cards, os planejadores, zooms, rodapés e a rolagem interna do Storage.

O diagnóstico com fontes DejaVu encontrou rodapés até 17,72px além da lateral. Um tipo de serviço longo no teste reproduziu a falha antes da correção também com as fontes padrão do Windows. Esse conteúdo agora integra a regressão permanente; a asserção mantém a tolerância de 1px e informa qual filho ultrapassou a caixa. Não foram incluídas fontes novas no produto.

O timeout de `admin.spec.ts` não se reproduziu localmente. A espera anterior pela mensagem de associação não garantia que a descoberta tivesse terminado, pois a mensagem também aparecia durante o carregamento. O teste agora aguarda o estado vazio final, identifica a linha pelo nome e verifica a abertura do editor antes de preencher. Somente esse caso tem orçamento total de 60s para login e duas rotas frias; as asserções continuam com o prazo normal, preservando UUID, PATCH e persistência. Nenhuma alteração de produção na administração, retry, skip ou remoção de teste.

Validação final desta correção:

- `npm run check` aprovado: lint (apenas o aviso preexistente de `IconBrandWhatsapp`), tipos, 301 unitários e build/empacotamento.
- **38/38 E2E** dos quatro arquivos completos: `admin`, `monitor-fonts`, `display-scale` e `storage-volumes`, com dois workers. Padrão/Ampliado, zoom 70/100/125, fontes até 200%, raiz e monitor, edição/persistência e Storage empilhado/não empilhado. O arquivo local ignorado de configuração concede 180s somente para iniciar o servidor de testes no Windows; não modifica as asserções nem o workflow do CI.
- Diagnóstico adicional aprovado com fontes DejaVu carregadas somente na página de teste: todos os rodapés ficaram dentro dos cards. O teste permanente usa o texto longo e não depende desses arquivos locais.
- **4/4 runtime** no artefato novo: cards/controles, encaixe inferior do Storage em iframe opaco, rolagem interna exclusiva e matriz de 252 combinações de fontes/zoom/perfil/KPIs, com snapshots e HTML sem JavaScript.

Não houve nova rodada integral dos dois shards. A execução foi local em Windows, incluindo o diagnóstico com fontes Linux; o próximo CI confirma o runner Linux. Preferências reais, versão antiga e layout das fileiras não foram alterados. Sem commit, push ou deploy.

## Referências tipográficas no runtime clássico — 06/11/2026

O CI seguinte aprovou 26 dos 27 testes runtime e falhou na comparação de fontes a 200%. A reprodução com DejaVu Sans/Mono confirmou que o título `Serviço configurado` (30px) estava sendo comparado ao horário `Leitura …` do card anterior (11px), em vez de ao próprio título (15px). O teste filtrava elementos de largura zero antes de associar as medições pelo índice. Quando o rótulo opcional do rodapé era truncado por completo, todos os índices seguintes mudavam.

A correção é exclusiva do teste: associar blocos por UUID e textos pela posição no DOM **antes** do filtro de visibilidade, além de conferir que o texto de referência é o mesmo. As tolerâncias continuam em 0,04px para fontes, 1,5px para altura do painel e 1px para largura; os limites de cards, fileiras, medidores e rolagem permanecem iguais. Nenhum CSS, renderer, zoom, controlador ou layout de produção foi alterado nesta etapa.

A matriz original de 252 combinações continua. Um cenário adicional aumenta somente o espaçamento entre caracteres dos horários na página de teste, confirma que um rótulo perde largura visível e verifica a proporcionalidade dos demais textos por identidade. Esse estilo é removido antes da checagem de rolagem e não é enviado ao aplicativo. Não depende de fontes externas ou específicas do sistema operacional. O diagnóstico local com DejaVu reproduziu a falha antes e passou depois; os arquivos de fonte permanecem apenas na pasta ignorada de diagnóstico.

Validação final: `npm run check` aprovado (lint, tipos, 301 unitários e build/empacotamento; apenas o aviso preexistente do ícone não utilizado). `npm run test:runtime` completo aprovado: **27/27**, sem skips, cancelamentos ou falhas. O caso de fontes passou também isoladamente e na reprodução com DejaVu Sans/Mono. Não houve nova execução E2E porque esta correção não altera a aplicação; o próximo CI confirma a rodada nativa Linux. Sem commit, push ou deploy.
