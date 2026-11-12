# Licenças e componentes de terceiros

## Licença do ORBIT

O código próprio é distribuído sob a [licença MIT](../LICENSE). Preserve o aviso de direitos autorais e o texto da licença ao redistribuir cópias ou partes substanciais. [Texto de referência da Open Source Initiative](https://opensource.org/license/mit)

## Dependências Node e do navegador

As versões exatas estão nos dois arquivos `package-lock.json`. O build mantém `THIRD-PARTY-NOTICES.txt` com avisos dos componentes presentes no runtime e no bundle.

| Grupo | Componentes e licenças declaradas |
| --- | --- |
| Runtime | `maxmind` 5.0.7 (MIT), `mmdb-lib` 3.0.3 (MIT) e `tiny-lru` 13.0.0 (BSD-3-Clause). |
| Bundle e ferramentas | Babel, Acorn, core-js, esbuild, PostCSS, postcss-custom-properties e whatwg-fetch (MIT nas dependências diretas). |
| Dependências transitivas de build | O lockfile declara MIT, MIT-0, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 e CC-BY-4.0. Preserve as atribuições e os textos exigidos se distribuir a árvore de build. |

## Dependências Python opcionais

As versões abaixo vêm de `tools/energy/requirements.txt`. O instalador básico deixa a criação do ambiente virtual a cargo do operador.

| Pacote | Versão | Licença |
| --- | --- | --- |
| TinyTuya | 1.20.0 | MIT |
| PyCryptodome | 3.23.0 | BSD-2-Clause e componentes em domínio público |
| Requests | 2.32.5 | Apache-2.0 |
| charset-normalizer | 3.4.4 | MIT |
| idna | 3.11 | BSD-3-Clause |
| urllib3 | 2.5.0 | MIT |
| certifi | 2025.10.5 | MPL-2.0 |
| colorama | 0.4.6 | BSD-3-Clause |

Ao distribuir um ambiente virtual preparado, preserve os avisos e as licenças fornecidos com os pacotes. [TinyTuya no PyPI](https://pypi.org/project/tinytuya/1.20.0/) · [Licença do PyCryptodome](https://www.pycryptodome.org/src/license) · [certifi no PyPI](https://pypi.org/project/certifi/2025.10.5/)

## Dados e executáveis opcionais

- **Natural Earth** — o mapa de terras em `public/world-land.json` usa dados em domínio público. [Termos do Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/)
- **GeoLite City e ASN** — os arquivos MMDB são instalados separadamente e seguem os termos da MaxMind, incluindo atribuição e condições sobre atualização e distribuição. A licença do leitor Node e a dos dados são independentes. [EULA do GeoLite](https://www.maxmind.com/en/geolite/eula)
- **Speedtest by Ookla** — o executável fica fora da distribuição. O operador obtém o cliente oficial e verifica os termos aplicáveis ao uso pretendido. [Página da CLI Ookla](https://www.speedtest.net/apps/cli)
