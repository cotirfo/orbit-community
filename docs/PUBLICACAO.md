# Preparação da publicação

Nome provisório do repositório: `orbit-community`. A revisão inicial deve ocorrer em um repositório privado, na conta confirmada pelo titular.

## Conferência local

1. Revise arquivos candidatos, ocultos, ignorados, fixtures, assets e metadados. Verifique também endereços, identificadores, caminhos e URLs que scanners de tokens podem não detectar.
2. Execute um scanner local com saída redigida, quando disponível. Revise o conteúdo preparado para o commit e repita a checagem no commit antes do envio autorizado.
3. Confira licença, avisos de terceiros, build, testes, instalação e rollback. Use configurações e dados fictícios.
4. Deixe fora da distribuição credenciais, dados de monitoramento, logs, backups, capturas reais, bases GeoLite, binários Ookla, dependências instaladas e saídas regeneráveis do build.
5. Registre o SHA, as exclusões e as limitações de teste para revisão do titular.

## Revisão privada e publicação

Confirme conta, repositório, visibilidade e destino antes de configurar qualquer remoto. A criação remota, o primeiro push e a mudança para visibilidade pública exigem autorização expressa. Antes de publicar, defina a licença do código próprio, confira a titularidade e prepare o canal de reporte de [SECURITY.md](../SECURITY.md). [Configuração do reporte privado no GitHub](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)
