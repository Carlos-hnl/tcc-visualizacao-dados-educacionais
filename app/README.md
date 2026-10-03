# App — Visualização Interativa de Dados Educacionais

Protótipo funcional em HTML + CSS + JavaScript vanilla, D3.js e DuckDB-Wasm.
Sem framework, sem bundler, sem build step.

## Como rodar

O navegador precisa buscar `data/escolas_ideb_infra_2025.csv` via HTTP (não funciona
abrindo o HTML direto pelo `file://`, por causa de CORS/fetch). Sirva a pasta `app/`
inteira (não só `app/public/`, porque `public/index.html` referencia `../src/`) com
qualquer servidor estático, por exemplo:

```bash
cd app
python3 -m http.server 8000
# depois abra http://localhost:8000/public/
```

ou, com Node:

```bash
cd app
npx serve .
# abra http://localhost:3000/public/
```

Na primeira carga, o DuckDB-Wasm baixa seu próprio motor (WebAssembly) de um CDN
(jsDelivr) e depois carrega o CSV (~40MB) — a tela de carregamento mostra o progresso.
Depois disso, todas as consultas rodam localmente no navegador, sem backend.

## Estrutura

```
app/
├── public/                            servido ao navegador
│   ├── index.html
│   └── data/
│       ├── escolas_ideb_infra_2025.csv   (cópia de data/processed/ — ver nota abaixo)
│       └── br-uf-topo.json               (malha das 27 UFs, TopoJSON simplificado)
└── src/                                módulos JS (referenciados via ../src/ a partir de public/index.html)
    ├── main.js         orquestração, boot, pipeline de consultas, cross-filter
    ├── data.js         inicialização do DuckDB-Wasm + catálogo de variáveis
    ├── queries.js       construtores de SQL a partir do estado de filtros
    ├── filters.js       estado global (pub-sub) + barra de filtros
    ├── map.js           Nível 1 — mapa coroplético (D3 + TopoJSON)
    ├── scatter.js        Nível 2 — pontos (canvas), tendência e boxplot (SVG)
    ├── comparison.js     Nível 3 — tabela de selecionadas + outliers
    ├── ui.js             tooltip, loading, formatação, debounce
    └── styles.css
```

**Por que o CSV está duplicado em `app/public/data/` e em `data/processed/`?** O
navegador só pode buscar arquivos dentro da pasta servida. Manter uma cópia aqui
evita depender de um caminho relativo fora de `app/`, que quebraria se `app/` for
publicada isoladamente (ex.: GitHub Pages apontando só para essa pasta). Depois de
rodar o `etl.py`, copie o CSV atualizado para cá também:

```bash
cp ../../data/processed/escolas_ideb_infra_2025.csv public/data/
```

## O que foi implementado

- Fases 1–4 da especificação: estrutura + DuckDB + filtros + mapa; scatter com
  reconhecimento automático de tipo de variável (contínua/binária/categórica);
  cross-filter completo (filtro global → mapa/scatter/comparação; clique no mapa →
  filtro de UF; brush no scatter → tabela de selecionadas; clique numa escola →
  destaque cruzado sem filtrar); tendência agregada; outliers por distância à
  tendência (sem regressão multivariada, conforme decidido).
- Fase 5 (refinamento/responsividade): grid responsivo (desktop/tablet/mobile) e
  estados vazios estão implementados; **não foi testado em navegador real** — ver
  "Limitações" abaixo.

## Decisões e pequenas divergências em relação à especificação

Nenhuma foi resolvida "silenciosamente" — todas estão registradas aqui:

1. **Estrutura de pastas:** a especificação pedia `/src`, `/data`, `/index.html` na
   raiz do repositório. O repositório já existente definia `app/public/` (servido ao
   navegador) e `app/src/` (módulos JS) como pastas separadas. Mantive essa divisão
   já documentada em vez de achatar tudo na raiz — `index.html` e os dados estáticos
   foram para `app/public/`, os módulos `.js`/`.css` continuam em `app/src/`,
   referenciados via `../src/...` a partir do HTML.
2. **Índice geral de infraestrutura:** não existe como coluna no CSV tratado. Em vez
   de alterar o `etl.py`, criei uma `VIEW` no DuckDB (`escolas_v`, em `data.js`) que
   calcula essa média a partir das 10 colunas binárias já presentes — zero mudança
   no pipeline Python.
3. **Distância à tendência (outliers):** implementada com `FLOOR`/`LEAST`/`GREATEST`
   em vez do `WIDTH_BUCKET` citado como exemplo na especificação — mesmo conceito
   (faixas da variável X), só uma forma mais previsível de lidar com valores no
   limite do intervalo.
4. **Domínio do eixo X:** usa o percentil 95 (não o máximo absoluto) como limite
   superior da escala, porque `computadores_por_aluno` tem um outlier de
   preenchimento em ~11.111 (documentado no relatório de estatísticas) que
   esmagaria a escala inteira. Pontos além do domínio ficam visualmente "presos" na
   borda direita do gráfico (`clamp`), nunca são removidos ou ocultados dos cálculos.
5. **Modo "Outliers" com variável binária/categórica:** desabilitado com uma
   mensagem explicativa — o conceito de "faixa da variável X" não se aplica bem a
   uma variável de 2–3 categorias; a especificação não detalhava esse caso.
6. **Clique numa UF no mapa:** atualiza o filtro (e portanto o scatter e o Nível 3)
   e destaca visualmente a UF selecionada no próprio mapa — mas não recalcula o
   Ideb médio *das outras* UFs, porque isso já é sempre calculado por UF
   independentemente do filtro de UF (só mudaria se outro filtro, como rede ou
   etapa, mudasse).

## Limitações conhecidas

- **Não testado em navegador real.** Este ambiente de desenvolvimento não tem
  acesso às CDNs (jsDelivr) usadas para carregar D3 e DuckDB-Wasm, então não foi
  possível abrir a aplicação e validar visualmente antes da entrega. O código foi
  revisado manualmente (sintaxe verificada, nomes de módulos/IDs cruzados,
  consultas SQL revisadas linha a linha), mas erros de execução em tempo real
  (ex.: um typo de API do DuckDB-Wasm, um caso de borda no brush) são possíveis.
  **Primeiro passo recomendado ao rodar localmente: abrir o Console do navegador
  (F12) e reportar qualquer erro — corrijo a partir daí.**
- Acessibilidade por teclado é parcial (foco visível em todos os controles, mas o
  brush do D3 e os pontos do canvas não têm navegação por teclado — limitação
  conhecida desse tipo de interação, não implementada nesta primeira versão).
- Amostragem visual para grandes volumes (Seção 17 da especificação) não foi
  implementada — o canvas desenha todos os pontos filtrados. Deve performar bem
  até a faixa de dezenas de milhares de pontos (o pior caso, sem filtro de etapa,
  seria ~78 mil escolas), mas vale medir na prática.
