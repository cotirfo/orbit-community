#!/usr/bin/env bash
set -euo pipefail
umask 022

usage() {
  cat <<'USAGE'
Uso: bash deploy/install.sh [--prefix DIRETÓRIO] prepare VERSÃO
     bash deploy/install.sh [--prefix DIRETÓRIO] activate VERSÃO

prepare   Instala dependências dos lockfiles e compila uma versão nova.
activate  Seleciona uma versão preparada, inclusive para rollback.

Padrão do prefixo: $XDG_DATA_HOME/orbit-community ou $HOME/.local/share/orbit-community.
O instalador trabalha apenas no prefixo informado.
USAGE
}

fail() {
  printf 'ORBIT: %s\n' "$*" >&2
  exit 1
}

prefix="${XDG_DATA_HOME:-$HOME/.local/share}/orbit-community"
if [[ ${1:-} == --prefix ]]; then
  [[ $# -ge 2 ]] || fail 'Informe o diretório após --prefix.'
  prefix=$2
  shift 2
fi

if [[ ${1:-} == --help || ${1:-} == -h ]]; then
  usage
  exit 0
fi
[[ $# -eq 2 ]] || { usage >&2; exit 2; }

action=$1
release=$2
[[ $action == prepare || $action == activate ]] || fail 'Use prepare ou activate.'
[[ $release =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || fail 'Identificador de versão inválido.'
[[ $prefix == /* && $prefix != / ]] || fail 'Use um prefixo absoluto diferente de /.'
[[ $(uname -s) == Linux ]] || fail 'Este instalador requer Linux.'

for tool in flock mkdir mktemp mv readlink realpath rm; do
  command -v "$tool" >/dev/null || fail "Pré-requisito ausente: $tool."
done
if [[ $action == prepare ]]; then
  for tool in node npm cp chmod dirname; do
    command -v "$tool" >/dev/null || fail "Pré-requisito ausente: $tool."
  done
  node -e 'const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major>20||major===20&&minor>=19?0:1)' ||
    fail 'O código requer Node.js 20.19 ou superior. Use uma linha LTS mantida.'
fi

# Resolve links and ".." before creating the release tree or opening its lock.
prefix=$(realpath -m -- "$prefix") || fail 'Não foi possível resolver o prefixo.'
[[ $prefix != / ]] || fail 'O prefixo resolve para /.'
mkdir -p -- "$prefix" || fail 'Não foi possível criar o prefixo. Confira as permissões.'
[[ ! -L $prefix/.install.lock && ! -L $prefix/releases ]] || fail 'O lock ou diretório de versões é um link inesperado.'
exec 9>> "$prefix/.install.lock"
flock -n 9 || fail 'Já existe uma preparação ou ativação em andamento.'

releases="$prefix/releases"
current="$prefix/current"
target="$releases/$release"
if [[ -L $current ]]; then
  current_target=$(readlink -- "$current")
  [[ $current_target =~ ^releases/[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || fail 'O link current aponta para fora da estrutura do instalador.'
elif [[ -e $current ]]; then
  fail 'Já existe um arquivo ou diretório chamado current. Escolha outro prefixo.'
fi

temporary=
cleanup() {
  if [[ -n $temporary && -d $temporary && ! -L $temporary ]]; then
    rm -rf -- "$temporary"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ $action == activate ]]; then
  command -v ln >/dev/null || fail 'Pré-requisito ausente: ln.'
  [[ -d $target && ! -L $target && -f $target/.orbit-release && ! -L $target/.orbit-release ]] ||
    fail 'Prepare essa versão antes de ativá-la.'
  [[ $(< "$target/.orbit-release") == "$release" && -s $target/public/infrastructure.js && -s $target/public/style.css ]] ||
    fail 'A versão preparada está incompleta.'
  temporary=$(mktemp -d -- "$prefix/.activate.XXXXXXXX")
  ln -s -- "releases/$release" "$temporary/current"
  mv -fT -- "$temporary/current" "$current"
  printf 'Versão selecionada: %s\n' "$release"
  exit 0
fi

[[ ! -e $target && ! -L $target ]] || fail 'Essa versão já existe. Use outro identificador.'
mkdir -p -- "$releases"
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
files=(
  package.json package-lock.json THIRD-PARTY-NOTICES.txt docs/LICENCAS.md
  config.example.json inventory.example.json speed-servers.json ookla-servers.json
  server.mjs settings.mjs panel-assets.mjs runtime.mjs collector.mjs collector-secret.mjs
  analysis.mjs telemetry.mjs cross-quality.mjs host-metrics.mjs linux-sockets.mjs
  controller.mjs control-auth.mjs monitor-gate.mjs lan-gateway.mjs
  huawei.mjs huawei-tls.mjs huawei-session-store.mjs
  energy-collector.mjs energy-metrics.mjs tuya-reader.mjs geo-connections.mjs
  speedtest.mjs server-selection.mjs wan-speed.mjs ookla.mjs
  public/index.html public/style-source.css public/app.js public/charts.js public/navigation.js
  public/activity.js public/activity-model.mjs public/topology-scene.js public/huawei-ui.js
  public/host-panel.js public/list-controls.js public/display-sanitize.js
  public/geo-connections.js public/geo-model.mjs public/world-land.json
  public/energy-panel.js public/energy-model.mjs
  tools/browser-build/package.json tools/browser-build/package-lock.json
  tools/browser-build/build.cjs tools/browser-build/entry.js tools/browser-build/compat-dom.js
  tools/energy/requirements.txt tools/energy/tuya-worker.py
)
if [[ -f $source_dir/LICENSE ]]; then files+=(LICENSE); fi
for file in "${files[@]}"; do
  [[ -f $source_dir/$file && ! -L $source_dir/$file ]] || fail "Arquivo-fonte ausente ou inválido: $file."
done

temporary=$(mktemp -d -- "$releases/.build.XXXXXXXX")
for file in "${files[@]}"; do
  mkdir -p -- "$(dirname -- "$temporary/$file")"
  cp -- "$source_dir/$file" "$temporary/$file"
done
(
  cd -- "$temporary"
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund ||
    fail 'Falha ao instalar as dependências de execução do lockfile.'
  npm --prefix tools/browser-build ci --include=dev --ignore-scripts --no-audit --no-fund ||
    fail 'Falha ao instalar as dependências do frontend.'
  npm --ignore-scripts run build || fail 'Falha ao compilar o frontend.'
  node --check server.mjs || fail 'Falha na checagem de sintaxe do ponto de entrada.'
  [[ -s public/infrastructure.js && -s public/style.css ]] || fail 'O build não gerou os arquivos do painel.'
  rm -rf -- tools/browser-build/node_modules
)
printf '%s\n' "$release" > "$temporary/.orbit-release"
chmod 0755 "$temporary"
mv -nT -- "$temporary" "$target"
[[ ! -e $temporary ]] || fail 'O destino da versão passou a existir. A preparação foi descartada.'
temporary=
printf 'Versão preparada: %s\n' "$target"
printf 'Para selecioná-la, execute activate %s com o mesmo prefixo.\n' "$release"
