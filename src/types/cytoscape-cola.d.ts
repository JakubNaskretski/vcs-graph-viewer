// cytoscape-cola ships without bundled type declarations; it's a cytoscape
// extension registered via cytoscape.use(). We only need the default export.
declare module "cytoscape-cola" {
  import { Ext } from "cytoscape";
  const ext: Ext;
  export default ext;
}
