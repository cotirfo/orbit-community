# EXEMPLO SANITIZADO: revisar todos os enderecos e pre-condicoes antes de importar.
# Remove apenas as duas sondas criadas por INSTALAR-SONDAS.rsc.
/tool netwatch remove [find where comment="ORBIT qualidade WAN1"]
/tool netwatch remove [find where comment="ORBIT qualidade WAN2"]
