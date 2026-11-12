# Operação, backup e recuperação

## Acompanhar o serviço

O [guia de instalação](INSTALACAO.md) usa a unidade `orbit-community.service`, um link `current` para a versão ativa e estado em `/var/lib/orbit-community`.

```sh
systemctl is-active orbit-community.service
systemctl show orbit-community.service --property=MainPID,NRestarts
curl -fsS -o /dev/null http://127.0.0.1:8787/api/status
```

Adapte a porta ao valor de `port`. Use `journalctl -u orbit-community.service` no host para investigar falhas de configuração, leitura e conexão. Redija logs antes de compartilhar, pois eles podem conter dados operacionais da rede.

## Backup do estado privado

| Caminho padrão do serviço | Conteúdo |
| --- | --- |
| `/etc/orbit-community/` | Configuração, inventário, arquivo de ambiente, credenciais, chaves e certificados quando usados. |
| `/var/lib/orbit-community/` | Histórico, testes de velocidade, energia, autenticação administrativa, auditoria, chave interna do relay e credenciais de renovação. |
| `/etc/systemd/system/orbit-community.service.d/` | Drop-ins locais, incluindo credenciais e opções da unidade. |
| `/opt/orbit-community/current` | Link da versão ativa. Registre o identificador e a origem do código correspondente. |

O Git guarda o código. Faça backup criptografado da configuração e do estado, mantendo proprietários e permissões. A credencial criptografada do RouterOS e sua chave devem ser restauradas em conjunto. Preserve a identidade do roteador associada ao arquivo de credencial. A chave derivada de renovação do Huawei também deve ser tratada como segredo.

Para dados gravados continuamente, use snapshots consistentes do sistema de arquivos ou programe uma janela de manutenção. Valide a restauração com estado separado, integrações desligadas e portas livres.

## Recuperação

1. Prepare a versão anterior com os lockfiles e assets correspondentes ou selecione uma versão ainda presente em `releases/`.
2. Use `activate` para trocar `current`. A troca afeta a próxima execução. Para a unidade systemd, reinicie durante a janela de manutenção e valide o status em loopback.
3. Quando a versão exigir um formato anterior de estado, restaure um backup compatível antes de reiniciar. Restaure configurações e credenciais nos caminhos externos e com permissões restritas.
4. Se uma credencial de integração se perder, cadastre-a novamente no equipamento ou no fluxo administrativo correspondente. As sessões de visualização pedem novo login após o reinício.
