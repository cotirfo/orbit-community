# Política de segurança

## Reporte privado

Na aba de segurança do repositório, use a opção de reportar uma vulnerabilidade quando o formulário privado estiver disponível. Se ele estiver indisponível, solicite um canal privado aos mantenedores. Em um pedido público de contato, omita os detalhes técnicos e os dados da instalação. [Como reportar privadamente no GitHub](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately)

No relato privado, inclua versão ou commit, módulos habilitados, pré-condições, impacto observado e evidências com dados fictícios ou redigidos. Remova senhas, tokens, chaves, sessões, endereços internos, identificadores e histórico de clientes. Combine com os mantenedores o momento da divulgação.

## Superfícies cobertas

O painel principal e o controlador escutam em loopback. O gateway pode ser habilitado na LAN e expõe dados de monitoramento de acordo com a configuração de redes, Host, TLS e autenticação. O ORBIT lê telemetria de RouterOS e Tuya e pode alterar configurações de dispositivos elegíveis por meio do Huawei. Arquivos de estado, logs e snapshots podem conter dados de rede e identificadores.

Ao avaliar um problema, informe quem consegue alcançar a superfície e quais permissões são necessárias. Exemplos de impacto relevante incluem leitura de telemetria fora da rede autorizada, vazamento de credenciais ou sessões, perda de validação TLS, ações de controle sem autorização e gravação fora do diretório de estado configurado.

## Propriedades esperadas

- A configuração do RouterOS valida a CA, o SHA-256 e a identidade HTTPS do destino. Huawei em HTTPS valida o pin do equipamento.
- O cadastro administrativo usa acesso local. Operações Huawei que alteram dispositivos exigem sessão, origem válida, proteção CSRF e confirmação. O relay do gateway é autorizado por chave interna. O acesso administrativo pelo gateway exige HTTPS e autenticação do monitor.
- Segredos e dados persistidos permanecem fora dos arquivos distribuídos. Respostas e logs de diagnóstico devem evitar credenciais e material criptográfico.
- Integrações desabilitadas não devem iniciar coleta. O módulo Tuya consulta medições em modo de leitura.

## Operação segura

Mantenha o gateway em redes privadas permitidas, configure TLS para acesso autenticado e use uma conta RouterOS dedicada com privilégios de leitura. Use um túnel SSH para acessar a administração loopback quando estiver fora do host. Proteja o diretório de estado e armazene certificados, chaves e credenciais fora do repositório. Revise os logs antes de compartilhar. Consulte o [guia de configuração](docs/CONFIGURACAO.md).
