# ORBIT Community Edition

Painel de monitoramento de redes e infraestrutura para instalações locais. O ORBIT reúne telemetria, histórico e diagnóstico no navegador. O painel abre em loopback com as integrações desabilitadas até que o operador configure seu ambiente.

## Funcionalidades

| Integração | O que o painel oferece |
| --- | --- |
| MikroTik RouterOS | Interfaces, recursos, rotas, conexões IPv4 e IPv6, DHCP, ARP, filas, cache DNS, Netwatch e métricas em `/metrics`. Coleta via REST sobre HTTPS. |
| Huawei AX3 | Inventário e telemetria de clientes em firmwares compatíveis. Operações autorizadas de renomear, limitar banda e bloquear dispositivos elegíveis. |
| Host Linux | Indicadores de CPU, memória, disco, interfaces e temperatura quando o hardware fornece a leitura. |
| Geo Connections | Mapa e histórico em memória de destinos públicos observados. Usa bases locais City e ASN, fornecidas pelo operador. |
| Velocidade | Medição HTTP pelo gateway. Perfis opcionais permitem atribuir medições à WAN após verificar o caminho. O cliente oficial Ookla é opcional. |
| Energia e nobreak | Leitura local de dispositivos Tuya 3.4 compatíveis, histórico de consumo e estimativa de autonomia com parâmetros configuráveis. |

O navegador recebe atualizações compartilhadas por SSE. O gateway de rede é opcional e oferece TLS e autenticação do monitor. O controlador administrativo opera em loopback.

## Primeira execução

Use Linux com uma linha Node.js LTS mantida e npm. O requisito técnico declarado pelo código é Node.js 20.19 ou superior. Confira o suporte da sua versão antes da instalação. [Calendário oficial do Node.js](https://nodejs.org/en/about/previous-releases)

A partir de uma cópia do código-fonte:

```sh
npm ci --ignore-scripts
npm --prefix tools/browser-build ci --ignore-scripts
npm run build
npm start
```

Abra `http://127.0.0.1:8787/`. O build gera `public/infrastructure.js` e `public/style.css`. A rede é necessária para baixar dependências na preparação, caso o cache esteja vazio. A execução inicial com os módulos desabilitados funciona sem acesso aos equipamentos.

## Instalação como serviço

O [guia de instalação Linux](docs/INSTALACAO.md) cobre preparação com os lockfiles, instalação via systemd, ativação e rollback. O instalador prepara a versão em `releases/<versão>` e seleciona `current` quando solicitado. A configuração e o histórico ficam em diretórios externos à versão.

## Configuração

Copie `config.example.json` e `inventory.example.json` para caminhos locais privados e ajuste os campos da sua rede. Use `ORBIT_CONFIG`, `ORBIT_INVENTORY` e `ORBIT_DATA_DIR` para apontar a instalação para esses arquivos e para o diretório de estado. O exemplo usa endereços de documentação e inicia com os módulos opcionais desligados.

O [guia de configuração](docs/CONFIGURACAO.md) descreve portas, TLS, credenciais, interfaces e intervalos. Consulte também [Geo Connections](docs/GEO-CONNECTIONS.md) e [Energia e nobreak](docs/ENERGIA-AUTONOMIA-SIMPLES.md). O gateway exige uma lista de redes IPv4 autorizadas. Prefira TLS e mantenha a administração local acessível pelo próprio host ou por túnel SSH.

## Diagnóstico rápido

- **Painel sem estilo ou scripts** — execute `npm run build` no código-fonte ou confira se `current` aponta para uma versão preparada pelo instalador.
- **RouterOS desativado ou aguardando login** — confira `routerOS.enabled` e cadastre a conta de leitura configurada. Se a CA for recusada, confira validade, nome do destino e SHA-256.
- **Gateway inacessível** — confira bind, porta, CIDRs, alias enviado no cabeçalho Host e arquivos TLS. O painel local continua disponível quando a abertura do gateway falha.
- **Huawei sem leitura** — confira origem de administração, rota, IPv4 de origem e pin para HTTPS. Mudanças de senha no equipamento podem exigir novo cadastro.
- **GeoLite ou energia sem dados** — confira os caminhos e as permissões dos arquivos, a disponibilidade do Python no módulo de energia e a compatibilidade do equipamento.

Veja [operação e recuperação](docs/OPERACAO.md) para validar o serviço, atualizar e restaurar uma versão.

## Contribuição, segurança e licenças

Consulte [CONTRIBUTING.md](CONTRIBUTING.md) para preparar alterações e [SECURITY.md](SECURITY.md) para reportar vulnerabilidades. Use somente configurações, capturas e fixtures fictícias em contribuições.

O código próprio é distribuído sob a [licença MIT](LICENSE). Os [avisos de terceiros](THIRD-PARTY-NOTICES.txt) e o [inventário de licenças](docs/LICENCAS.md) registram as dependências e as condições dos componentes opcionais.
