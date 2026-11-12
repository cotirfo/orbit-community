# ORBIT Geo Connections

O módulo combina conexões observadas no RouterOS com bases GeoLite2 locais.

## Estratégia e contratos

O módulo usa exclusivamente `connections.rows` produzido por `analysis.mjs` e
recebido em `collector.mjs`. Não cria coletor, sondas, DNS reverso ou chamadas
REST adicionais. Processa até as 1.000 linhas já expostas, após a ordenação
existente. `coverage.partial` informa quando esse recorte não cobre a tabela;
as contagens e rankings Geo se referem somente às linhas observadas. IPv6
indisponível é identificado separadamente. Conexões curtas entre coletas
podem faltar; FastTrack/offload também limita a interpretação dos bytes.

`geo-connections.mjs` filtra IPs especiais, normaliza IPv6, deduplica consultas,
enriquece destinos e agrega por origem, destino, porta, protocolo e WAN.
O adaptador lê GeoLite2 City e ASN em MMDB local, independentemente: uma base
ausente ou corrompida não derruba a outra nem o coletor. Campos desconhecidos
permanecem nulos. Coordenadas exigem latitude e longitude numéricas válidas;
zero é válido, ausência de coordenadas nunca vira um ponto em (0,0).

A seleção é conservadora: exclui endereços inválidos, privados, loopback,
link-local, multicast, CGNAT, documentação, benchmarking e prefixos especiais
de protocolo/transição/AS112/AMT. IPv6 aceita unicast global `2000::/3` fora
das exclusões; IPv4 mapeado, NAT64 e endereços com zone ID não são enriquecidos.
Referências: registros oficiais IANA de
[IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry) e
[IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry).

`/api/status` e o snapshot SSE ganham o campo aditivo `geoConnections`:

- `state`, `time`: estado e instante da última observação de conexões;
- `databases.city/asn`: estado, data da base e tamanho; nenhum caminho local;
- `rows`: combinações atuais, origem observada, IP/porta/protocolo/WAN,
  quantidade de conexões e resultado GeoIP;
- `history`: últimas observações limitadas, com primeiro/último instante,
  quantidade na última observação, pico e número de snapshots;
- `coverage`, `limits`, `historyEvictions`: cobertura e limites explícitos.

O evento SSE aditivo `geo` transporta `{geoConnections: ...}`. O gateway já
repassa eventos e mescla esses objetos no cache para novos visualizadores.
O frontend também funciona pelo polling existente. Nenhuma nova rota de
dados foi criada e a autenticação HTTPS/LAN existente foi preservada. O bind
loopback do coletor continua como antes. Não exponha o coletor diretamente
fora do host, nem remova a proteção do gateway.

## Origem, NAT e WAN

O destino é o `dst-address` da tupla original observada pelo MikroTik, sem
inferência de destino final após DNAT ou de aplicação. Uma linha de entrada
também pode ter como destino o próprio endereço público da rede. Os nomes
de origem usam somente DHCP bound/ARP de leituras válidas dos últimos 120s;
nomes não confirmam a identidade de uma pessoa ou o dono do tráfego.

`192.0.2.45` recebe sempre **Huawei AX3 — dispositivos internos agregados**,
mesmo se o inventário listar vários clientes. O endereço é configurável para
outras topologias. A WAN vem exclusivamente do campo já confirmado por
`analysis.mjs`, usando o endereço de resposta NAT e os clientes WAN. Marca PCC
sozinha não confirma WAN; campos ausentes permanecem não identificados.

A inspeção não invasiva do código Huawei encontrou `HostInfo`, inventário,
taxas por dispositivo, informações WAN e diagnósticos, mas nenhum contrato
de tabela NAT com tuplas internas/externas. O painel reutiliza o callback
de telemetria Huawei para mostrar esse inventário sem novas chamadas e sem
atribuir destinos a `192.168.3.x`. Correlação individual fica fora deste escopo.

## Interface e cartografia

A seção `#geo-connections` oferece mapa SVG mundial com zoom, arraste e
controles de teclado, pontos selecionáveis, KPIs, rankings, tabela paginada
e detalhes por destino. Os filtros combinam origem, país, ASN/provedor,
protocolo e WAN. O histórico tem uma visão própria. Pontos com coordenadas
iguais são agrupados e mostram todos os destinos daquele local ao selecionar.
O SVG da cartografia permanece estável; marcadores e trajetos são atualizados
por chave sem reconstruir o mapa. O frontend usa o build ES5 e a CSP existente.
Não foi acrescentada biblioteca de mapas.

Desde 21/10/2026, a apresentação usa trajetos curvos neon: uma linha para cada
conexão contabilizada nas combinações com coordenadas, com cores/defasagens
estáveis e limite visual de 700 linhas, informado na tela. Os filtros restringem
também as linhas; dados/tabela não são truncados por esse limite visual.
As linhas representam a contagem observada, sem identificar sessões individuais
dentro de uma combinação. No histórico, usam a última contagem de cada combinação.

O mapa usa um ponto ilustrativo para desenhar as linhas sem expor a localização da instalação. O enriquecimento se aplica a destinos públicos. Pulsos mostram
direção, sem alegar taxa, pacotes ou caminho real de roteamento.
Animações param no histórico, com leitura antiga,
visão pausada, aba oculta ou mapa fora da tela; há botão próprio para pausá-las.
`prefers-reduced-motion` mantém as linhas estáticas.

Os pontos abrem um resumo ao receber cursor ou foco, e também por toque/clique.
O resumo mostra local aproximado, conexões/destinos, ASN/provedor, amostra de IPs,
coordenadas e raio informado, WAN, protocolos/portas, origens observadas e instante
da leitura. Destinos coincidentes compartilham o ponto; o botão de detalhes abre
todos os registros correspondentes. Escape, fechar ou clicar fora dispensa o
resumo. O rótulo da origem também explica a referência municipal. O halo da
origem não captura o cursor dos destinos próximos.

O botão “i” do título explica finalidade, leitura e limites do Geo. A busca textual
de destinos combina-se aos filtros e ocorre antes da paginação, afetando também
mapa e rankings. As listas longas do painel têm altura limitada, filtro textual
quando não há busca própria, contagem e botão Expandir/Recolher. No Geo, a tabela
mantém a paginação e a busca global; sua contagem local indica “nesta página”.
Rankings Geo deixam de cortar as oito primeiras entradas e passam a permitir
rolagem, busca e expansão. Pop-ups, detalhes e buscas respeitam a ocultação de
identificadores; a troca dessa preferência limpa as novas buscas.

O arquivo `public/world-land.json` é a camada Land Natural Earth 1:110m,
em domínio público, incorporada no bundle. Origem e termos:

- <https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson>
- <https://www.naturalearthdata.com/about/terms-of-use/>

O mapa é uma referência mundial aproximada, sem fronteiras políticas ou
tiles externos. O nível de detalhe é adequado a destinos aproximados de IPs,
não a ruas. País/cidade/coordenadas GeoIP descrevem infraestrutura; CDN, VPN,
proxy e anycast podem apontar para outra região. O módulo nunca determina a
localização física de usuários. A preferência existente de ocultar IP/MAC
também se aplica aos filtros, detalhes, inventário e exportação JSON. Ela é
uma preferência visual; o acesso aos dados depende da autenticação do monitor.

## Dependências e licença dos dados

Dependência de execução adicionada: `maxmind` 5.0.7 (MIT), com `mmdb-lib`
(MIT) e `tiny-lru` (BSD-3-Clause), fixadas no `package-lock.json`. Justificativa:
leitor MMDB para IPv4/IPv6 sem reinventar o formato binário. O build copia os
avisos desses pacotes para `THIRD-PARTY-NOTICES.txt`.

Nenhuma base MMDB é redistribuída. O caminho padrão está sob `data/`, já
ignorado, e `*.mmdb` é ignorado globalmente no repositório. GeoLite2 exige
conta, chave para download, aceite pelo operador e atribuição conforme os
termos do fornecedor. A utilização local do módulo foi preparada para esse
modelo; o operador deve verificar a adequação dos termos ao uso pretendido.
O painel contém a atribuição MaxMind, inclusive quando está pendente.

- Obtenção e documentação oficial: <https://dev.maxmind.com/geoip/geolite2-free-geolocation-data/>
- EULA: <https://www.maxmind.com/en/geolite/eula>
- Download/atualização: <https://support.maxmind.com/knowledge-base/articles/download-and-update-maxmind-databases>
- Leitor: <https://github.com/runk/node-maxmind>

O código não aceita os termos, não baixa bases nem consulta IPs em serviços
públicos. Instale manualmente **GeoLite2-City.mmdb** e **GeoLite2-ASN.mmdb**,
descompactadas. Não use a versão gzip diretamente. Uma base City de outro
tipo no lugar da ASN (ou vice-versa) é rejeitada. O módulo funciona sem bases.

## Configuração

Adicione opcionalmente a `config.json` local, preservando os outros campos:

```json
"geoConnections": {
  "cityDatabase": "data/geoip/GeoLite2-City.mmdb",
  "asnDatabase": "data/geoip/GeoLite2-ASN.mmdb",
  "huaweiNatAddress": "192.0.2.45",
  "maxCacheEntries": 2048,
  "cacheTtlSeconds": 86400,
  "maxHistoryEntries": 2000,
  "retentionMinutes": 60
}
```

Os valores acima são os padrões e não exigem alterar a configuração existente.
Caminhos relativos são resolvidos a partir da raiz da aplicação; caminhos
absolutos também são aceitos. O usuário do processo precisa de leitura.
Credenciais da MaxMind ficam somente na ferramenta de download do operador,
fora do repositório, do `config.json` e dos logs compartilhados.

| Parâmetro | Limites |
| --- | --- |
| maxCacheEntries | 1 a 20.000 IPs |
| cacheTtlSeconds | 1 a 604.800 s |
| maxHistoryEntries | 1 a 10.000 combinações |
| retentionMinutes | 0 a 10.080 min; zero desativa histórico |

O cache LRU inclui resultados negativos e erros, com a validade configurada;
expirado, o IP é consultado novamente localmente. As bases são carregadas
uma vez por instância do coletor, sem watchers. Depois de instalar/atualizar,
use uma janela autorizada para reiniciar o processo ou o mecanismo existente
de recarga do coletor. A nova instância esvazia cache/histórico e abre os novos
arquivos.

Atualize as duas bases regularmente com a ferramenta oficial `geoipupdate`
ou downloads oficiais, de acordo com os termos e a cadência do fornecedor.
Valide os arquivos em uma instalação isolada antes da troca; substitua cada
arquivo por rename atômico no mesmo filesystem. Evite cópias acumuladas das
bases, inclusive em backups, além do permitido pelos termos. A interface
mostra o timestamp da base e destaca idade superior a 30 dias; isso não
substitui a política de atualização do operador.

## Recursos e retenção

O histórico é volátil, sem gravação adicional em disco. Reiniciar/recarregar
perde esse histórico. Repetições não criam uma linha por snapshot: atualizam
a combinação existente. A capacidade tem prioridade sobre o tempo de retenção,
com descarte das combinações menos recentemente vistas. A interface informa
descartes por capacidade. A consulta de histórico também expira entradas.

Contagens atuais representam conexões simultaneamente observadas. Histórico
representa a última contagem de cada combinação em instantes potencialmente
distintos; não some como conexões únicas, simultâneas ou consumo de banda.
`samplesSeen` conta observações, não novas sessões.

Consultas usam lotes de 32 IPs e cedem ao event loop entre lotes. O limite de
1.000 linhas é preservado, e a consulta Geo não toca a REST do MikroTik. O
agendamento ocorre após o processamento, com os mesmos intervalos e redução
por CPU já existentes; o tempo local de enriquecimento pode acrescentar uma
pequena latência à rodada, sem sobreposição de coletas.

Memória: dois buffers MMDB residentes mais caches limitados (512 entradas
de decoder por base, 2.048 IPs e 2.000 combinações por padrão). Arquivos acima
de 128 MiB City ou 32 MiB ASN são recusados. Além desses buffers, há objetos
do decoder, linhas, histórico e serialização JSON temporária; o teto dos
arquivos não é um limite exato do RSS. O mapa fonte tem cerca de 135 KiB e é
embarcado uma vez no bundle. SSE transporta até 1.000 combinações atuais e o
histórico limitado por rodada; monitore RSS e backpressure com os limites
de viewers já existentes. Não foi medida carga real no Debian nesta entrega.

## Validação isolada

```sh
npm ci
npm --prefix tools/browser-build ci
npm run check
npm run build
npm test
```

As fixtures nunca consultam roteadores. Os testes Geo cobrem IPs, bases
ausentes/corrompidas, normalização de campos, falhas de consulta, cache,
retenção, limites, origem/NAT/WAN, filtros e rankings. O teste HTTP/SSE usa
somente servidores loopback sintéticos e o gate existente para verificar
401 sem autenticação, bloqueio cross-site, relay e snapshot em cache.
O teste do coletor verifica também a emissão do evento Geo.

Preview exclusivamente sintético, após compilar:

```sh
node tools/preview-geo.mjs
# http://127.0.0.1:18990/#geo-connections
node tools/preview-geo.mjs --pending
node tools/preview-geo.mjs --stale
```

Execute uma variante por vez e encerre com Ctrl+C. O preview importa somente
o módulo Geo e serve fixtures. Não lê config/credenciais nem inicia runtime,
controlador ou gateway reais. As localizações de fixture são fictícias e
identificadas como tais. Não use o preview como serviço de produção.
