# Configuracao e integracoes

## Arquivos locais

Com os assets compilados, `npm start` abre o painel em loopback. `config.json` e `inventory.json` são opcionais. Use `ORBIT_CONFIG`, `ORBIT_INVENTORY` e `ORBIT_DATA_DIR` para escolher os caminhos. Caminhos relativos nessas variáveis partem do diretório de execução. Caminhos relativos dentro do JSON partem do diretório desse JSON. Sem override, o estado fica em `data/` na raiz da aplicação. Guarde configurações e credenciais reais em diretórios fora do repositório.

| Campo | Função |
| --- | --- |
| `port`, `lan.listenAddress`, `lan.port` | Porta local e endereço/porta do gateway opcional |
| `lan.allowedSubnets`, `lan.hostAliases`, `lan.additionalPorts` | Redes IPv4/CIDR, cabeçalhos Host aceitos e portas HTTP complementares |
| `lan.controlPort`, `lan.adminNatSources` | Porta local de administração e origens NAT que exigem pareamento por dispositivo |
| `monitorHttps` | TLS e login no gateway. Configure `keyFile`, `certFile`, `caFile` opcional e `sessionSeconds` |
| `routerOS.enabled`, `routerUrl`, `caFile`, `caFingerprint` | Habilitação do REST HTTPS e CA com SHA-256 verificado |
| `routerOS.user`, `routerOS.timeoutMs`, `persistCollector` | Conta de leitura, timeout e persistência criptografada opcional. A chave pode vir de `ORBIT_COLLECTOR_KEY_FILE` |
| `intervalSeconds`, `connectionSeconds`, `detailsSeconds`, `retentionDays` | Cadências e retenção do RouterOS |
| `wan`, `monitoredInterfaces`, `lanInterface` | Mapeamento dos slots WAN1 e WAN2, portas a consultar e interface LAN da topologia |
| `crossQuality` | Cadência e dois links com `name`, `source`, `gateway` e `table` para validar as sondas comparáveis |
| `huawei` | Habilitação, origem, pin, IPv4 de origem para HTTPS, MACs protegidos e intervalos de coleta/heartbeat |
| `geoConnections` | Habilitação, arquivos MMDB, limites de retenção e `mapOrigin` opcional com rótulo, latitude e longitude aproximadas |
| `speedTest` | Medição pelo gateway, agendamento, perfis WAN e `catalogFile`. Ookla tem catálogo e binário próprios |
| `energy` | Endereço, ID e protocolo Tuya, Python, timeout e modelo elétrico `hardware`. Use `ORBIT_ENERGY_CREDENTIAL_FILE` ou credencial do systemd para a chave |

O inventário associa os slots WAN1 e WAN2 às interfaces, sondas e capacidades contratadas da instalação. Preencha zero, um ou dois slots e use as mesmas interfaces em `wan` quando o campo estiver presente. Ative somente os módulos configurados. Uma origem Huawei HTTPS exige pin SHA-256 e IPv4 de origem. Use HTTP somente quando o equipamento estiver acessível por IPv4 privado.

## Variaveis de ambiente

| Nome | Uso |
| --- | --- |
| `NODE_ENV` | Indicacao do ambiente; o systemd define `production` |
| `MIKROTIK_USER` | Conta de leitura; o cadastro atual aceita `orbit-monitor` |
| `MIKROTIK_PASSWORD` | Credencial de execucao opcional; prefira o cadastro HTTPS persistido |
| `CREDENTIALS_DIRECTORY` | Diretorio protegido fornecido por systemd/LoadCredential |
| `HOME` | Estado do usuario de servico, incluindo preferencias do cliente Ookla |

`.env.example` e apenas um modelo, sem senha. O Node pode ler uma copia local
com `node --env-file=.env server.mjs`; nao use isso para substituir a chave do
systemd ou publicar uma credencial. Nao coloque segredos em parametros de CLI.

## RouterOS

O coletor faz leituras REST HTTPS de recursos, interfaces, conexoes, rotas,
regras, filas, inventario e eventos. Use uma conta dedicada de leitura,
restrita ao IP do coletor, sem permissao administrativa. A CA e seu fingerprint
são verificados quando o RouterOS é habilitado; falha de autenticacao invalida a credencial salva.

Os scripts em `examples/routeros/*.example.rsc` sao modelos ilustrativos da integração. Os IPs/MACs sao ficticios. Alguns scripts exigem regras e
nomes previamente existentes, outros tratam migracoes antigas ou reversao;
nao sao uma sequencia de instalacao universal. Revisa-los nao autoriza importa-los.

## Huawei

O cliente implementa o desafio de autenticacao do firmware compativel, sessoes,
renovacao automatica e consultas serializadas. Gestao pela WAN exige origem
permitida no equipamento, bind de origem e certificado fixado. O repositorio
nao inclui firmware capturado, sessoes, cookies, sal ou chave derivada reais.

A credencial de renovacao e salva por `huawei-session-store.mjs` com diretorio
0700 e arquivo 0600; e equivalente a um segredo. O formulario administrativo
mascara a senha; o codigo de pareamento tem um campo distinto, vida curta e uso
unico. Alteracoes exigem sessao, CSRF, revisao e confirmacao.

## TLS do monitor e acesso local

O controlador em loopback e o gateway HTTPS autenticado oferecem o acesso administrativo ao Huawei. Configure os certificados do monitor para usar os controles pela LAN.

`monitor-gate.mjs` usa login HTTPS e cookie Secure/HttpOnly/SameSite=Strict.
O gateway lê a chave e o certificado configurados em `monitorHttps`. Esses arquivos
precisam existir e ter permissoes adequadas antes de habilitar o monitor HTTPS.
A emissao/confianca do certificado e um procedimento do operador, nao do build.

## Medicao e metricas

Os catalogos `speed-servers.json` e `ookla-servers.json` contêm endpoints publicos
da integracao, sem credenciais. Uma medicao so e atribuida a uma operadora quando
a conexao e observada na WAN correspondente. As regras do roteador precisam
existir; o codigo do painel nao as instala. Binario Ookla e termos nao sao
incluidos ou aceitos automaticamente.

`host-metrics.mjs` usa `/proc`, sysfs e interfaces do sistema. Linux fornece
as metricas mais completas; alguns testes de permissoes e sockets sao especificos
de POSIX/Linux e sao pulados em Windows.
