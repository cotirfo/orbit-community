# Exemplos operacionais

Nenhum script deste diretorio e executado por `npm install`, build ou teste.

- RouterOS: modelos `.example.rsc` preservam logica original e pre-condicoes,
  mas usam IPs de documentacao e MACs ficticios. Revisao e adaptacao sao
  obrigatorias; eles podem criar/alterar regras se importados manualmente.
- Windows: auxiliares legados, incluindo firewall e launchers. Os enderecos
  foram sanitizados e os launchers pressupõem a raiz da aplicacao.
- Linux: exemplo interativo de Wi-Fi, com senha oculta no terminal. Recebe o nome da interface como primeiro argumento e altera a rede se executado manualmente.

Estes exemplos nao sao a configuracao da producao nem uma receita para
reconfigurar automaticamente a rede existente.
