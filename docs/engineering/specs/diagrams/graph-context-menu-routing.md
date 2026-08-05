# Graph right-click routing

A component diagram of which module answers a `contextmenu` event on the dependency canvas.
One global listener already exists; the canvas contributes objects and two local menus.

```mermaid
graph TD
  subgraph app["App shell"]
    OCM["ObjectContextMenu<br/>(the app's one contextmenu listener)"]
    REG["ActionRegistry"]
    TAD["task action domain<br/>(new: registers once)"]
  end

  subgraph canvas["components/canvas"]
    TN["TaskNode<br/>(stamps objectTargetProps)"]
    DE["DependencyEdge<br/>(new custom edge)"]
    PANE["Canvas"]
    EM["EdgeContextMenu<br/>(canvas-local)"]
    PM["PaneContextMenu<br/>(canvas-local)"]
    MUT["useTaskGraphMutations"]
  end

  TN -->|"object ref"| OCM
  OCM -->|"what applies to this object?"| REG
  TAD -->|"register(domain, defs)"| REG
  REG -->|"resolved actions"| OCM

  DE --> EM
  PANE --> PM
  EM --> MUT
  PM --> MUT
  TAD --> MUT
```
