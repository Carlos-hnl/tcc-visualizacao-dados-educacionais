# Dados tratados

`escolas_ideb_infra_2025.csv` é a saída de `etl/etl.py`: uma linha por combinação
escola × etapa de ensino, já integrando Censo Escolar 2025, Ideb 2025 e INSE 2023,
restrita à rede pública (Federal, Estadual, Municipal).

- 127.395 linhas × 56 colunas (~40 MB)
- Detalhes de cada coluna: `docs/relatorios/`

## Sobre versionar este arquivo no Git

40 MB está dentro do limite do GitHub (100 MB por arquivo), então **dá para versionar
normalmente** por enquanto. Se a base crescer bastante (por exemplo, ao incluir mais
edições do Ideb ou do Censo), considere migrar para
[Git LFS](https://git-lfs.com/) para não pesar o histórico do repositório.
