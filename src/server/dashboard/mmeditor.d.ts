declare module "mmeditor" {
  interface NodeData {
    uuid: string
    type: string
    name: string
    x: number
    y: number
    width?: number
    height?: number
    [key: string]: unknown
  }

  interface LineData {
    uuid: string
    from: string
    to: string
    fromPoint?: number
    toPoint?: number
    [key: string]: unknown
  }

  interface SchemaData {
    nodes: (NodeData & Record<string, unknown>)[]
    lines: (LineData & Record<string, unknown>)[]
  }

  interface InstanceNode {
    dom: SVGElement
    shape?: SVGElement
    data: NodeData
    linkPoints: unknown[]
    fromLines: Set<string>
    toLines: Set<string>
    _destroys: (() => void)[]
  }

  interface NodeManager {
    nodes: Record<string, InstanceNode>
    addNode(data: NodeData): InstanceNode
    registeNode(type: string, config: Record<string, unknown>): void
    deleteNode(input: string | { uuid: string }): void
    update(): void
    updateNode(input: string | object, rerenderShape?: boolean): void
  }

  interface LineManager {
    lines: Record<string, unknown>
    addLine(data: LineData): void
    deleteLine(id: string, noEvent?: boolean, fromNode?: boolean): void
  }

  interface Graph {
    node: NodeManager
    line: LineManager
    config: Record<string, unknown>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(event: string, handler: (...args: any[]) => void): void
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    off(event: string, handler: (...args: any[]) => void): void
    fire(event: string, data?: unknown): void
    clearGraph(): void
    update(): void
    render(data: unknown): Promise<void>
    destroy(): void
  }

  interface Schema {
    data: { nodesMap: Record<string, NodeData>; linesMap: Record<string, LineData> }
    setData(data: SchemaData): Promise<void>
    setInitData(data: SchemaData): Promise<void>
    getData(): SchemaData
    format(): void
    history: { clear(): void; push(data: unknown): void }
  }

  interface Controller {
    scale: number
    x: number
    y: number
    autoFit(center?: boolean, vertical?: boolean): void
    autoScale(padding?: number): void
    clear(): void
  }

  interface VEditorOptions {
    dom: HTMLElement
    mode?: string
    config?: Record<string, unknown>
    [key: string]: unknown
  }

  class VEditor {
    constructor(options: VEditorOptions)
    config: Record<string, unknown>
    dom: HTMLElement
    svg: SVGElement
    paper: SVGGElement
    container: HTMLElement
    graph: Graph
    schema: Schema
    controller: Controller
    minimap?: unknown
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(event: string, handler: (...args: any[]) => void): void
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    off(event: string, handler: (...args: any[]) => void): void
    fire(event: string, data?: unknown): void
    clear(): void
    destroy(): void
    repaint(): void
  }

  export default VEditor
}
