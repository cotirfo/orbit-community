# Instalação Linux

O instalador foi projetado para Linux com Bash, utilitários GNU e `flock` (util-linux). Prepare a versão como usuário comum, com Node.js LTS e npm no `PATH`. Use um host com systemd se quiser executar o ORBIT como serviço. Uma instalação local exige apenas Node.js e os assets compilados depois da preparação.

## Preparar e executar sem systemd

Na raiz do código-fonte, escolha um identificador para a versão. O prefixo padrão é `$XDG_DATA_HOME/orbit-community` ou `$HOME/.local/share/orbit-community` quando a variável está ausente.

```sh
prefix="$HOME/.local/share/orbit-community"
bash deploy/install.sh --prefix "$prefix" prepare 0.1.0
bash deploy/install.sh --prefix "$prefix" activate 0.1.0
ORBIT_DATA_DIR="$HOME/.local/state/orbit-community" node "$prefix/current/server.mjs"
```

Abra `http://127.0.0.1:8787/`. Encerre o processo com Ctrl+C. Para usar arquivos externos, exporte `ORBIT_CONFIG` e `ORBIT_INVENTORY` com caminhos existentes antes de iniciar o Node.

`prepare` usa `npm ci` com os dois lockfiles, compila o frontend e mantém a versão pronta em `releases/`. Se uma etapa falhar, a preparação incompleta é removida. Um identificador existente é recusado. `activate` troca o link `current` e preserva as versões anteriores. [Comportamento de npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/)

## Instalar como serviço

Este exemplo usa `orbit-community.service` com versões em `/opt/orbit-community` e estado privado em `/var/lib/orbit-community`. Confirme que esse prefixo está livre ou pertence à mesma instalação Community Edition. O Node do serviço deve estar acessível fora dos diretórios pessoais. A unidade usa `/usr/bin/node`. Se o binário estiver em outro caminho, ajuste `ExecStart` com um drop-in.

Em uma primeira instalação, crie o usuário de serviço e o prefixo:

```sh
if ! getent passwd orbit-community >/dev/null; then
  sudo useradd --system --user-group --home-dir /var/lib/orbit-community \
    --shell /usr/sbin/nologin orbit-community
fi
sudo install -d -m 0755 -o "$(id -un)" -g "$(id -gn)" /opt/orbit-community
bash deploy/install.sh --prefix /opt/orbit-community prepare 0.1.0
bash deploy/install.sh --prefix /opt/orbit-community activate 0.1.0
```

Instale a unidade apenas se ela ainda não existir. Se já existir, compare o arquivo e preserve os ajustes locais.

```sh
if ! sudo test -e /etc/systemd/system/orbit-community.service; then
  sudo install -m 0644 deploy/systemd/orbit-community.service \
    /etc/systemd/system/orbit-community.service
fi
sudo systemctl daemon-reload
sudo systemctl enable --now orbit-community.service
systemctl is-active orbit-community.service
```

O systemd cria o diretório de estado com acesso restrito ao usuário do serviço. As sessões de visualização são mantidas em memória. [Manual do systemd sobre diretórios e credenciais](https://manpages.debian.org/trixie/systemd/systemd.exec.5.en.html)

## Configuração e credenciais do serviço

1. Crie `/etc/orbit-community` com acesso de leitura para o grupo do serviço, usando `sudo install -d -m 0750 -o root -g orbit-community /etc/orbit-community`.
2. Crie `config.json` e `inventory.json` a partir dos [exemplos](../config.example.json), somente se os destinos estiverem livres. Ajuste os dados para sua instalação e mantenha os arquivos com proprietário `root`, grupo `orbit-community` e modo `0640`.
3. Crie `/etc/orbit-community/orbit.env` com as linhas abaixo. Inclua somente caminhos para arquivos já criados. O serviço também funciona sem esse arquivo, com o painel local e os módulos desabilitados.
4. Habilite as integrações escolhidas, confira os caminhos no [guia de configuração](CONFIGURACAO.md) e reinicie o serviço em uma janela de manutenção.

```ini
ORBIT_CONFIG=/etc/orbit-community/config.json
ORBIT_INVENTORY=/etc/orbit-community/inventory.json
```

Use os drop-ins opcionais de [credenciais do RouterOS](../deploy/systemd/collector-credential.example.conf) e [energia](../deploy/systemd/energy-credential.example.conf) quando necessário. As fontes de `LoadCredential` ficam fora do repositório. Para o gateway HTTPS, o exemplo usa a porta `8443`. A unidade básica roda sem capacidades adicionais. Se precisar de uma porta abaixo de 1024, instale o [drop-in de portas baixas](../deploy/systemd/low-port.example.conf) em `/etc/systemd/system/orbit-community.service.d/` e execute `daemon-reload` antes de reiniciar.

Para o módulo Tuya, use Python 3 com suporte a `venv`. Prepare um ambiente virtual fora da árvore de versões e indique o caminho do interpretador em `energy.pythonPath`:

```sh
python3 -m venv /caminho/privado/venv-orbit-energia
/caminho/privado/venv-orbit-energia/bin/python -m pip install --no-deps \
  -r tools/energy/requirements.txt
```

Garanta que o usuário de serviço consegue executar o interpretador. A chave Tuya fica no arquivo de credenciais, separada do JSON de configuração. A instalação básica não baixa bases GeoLite nem instala ou aceita termos da CLI Ookla. O operador providencia esses componentes conforme os [termos aplicáveis](LICENCAS.md).

## Atualizar e reverter

1. Obtenha o código da versão pretendida em outra pasta e execute `prepare` com o mesmo prefixo e um identificador novo.
2. Antes de ativar, registre o alvo de `readlink /opt/orbit-community/current` e confira o backup de configuração e estado. Se necessário, valide a versão em outra porta e com um diretório de estado separado.
3. Execute `activate NOVA_VERSÃO`. Para o serviço systemd, reinicie `orbit-community.service` e confira o endpoint de status na porta configurada.
4. Em caso de falha, execute `activate VERSÃO_ANTERIOR` com o mesmo prefixo e reinicie o serviço. Se uma versão futura migrar o formato dos dados, restaure um backup compatível antes de voltar.

A primeira distribuição usa instalação direta e systemd. Docker e Compose foram considerados. O acesso a interfaces do host, endereços de origem e equipamentos na LAN precisaria de configuração adicional de rede e permissões. Consulte [operação e backup](OPERACAO.md).
